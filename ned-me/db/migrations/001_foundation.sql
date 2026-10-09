-- NED M&E Control Tower — 001 Fondation : multi-tenant, organisations, programmes, projets, audit
-- Isolation : RLS PostgreSQL pilotée par app.tenant_id (SET LOCAL par transaction côté API).
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE SCHEMA IF NOT EXISTS app;

-- Rôle applicatif : jamais superuser, jamais BYPASSRLS.
-- Les rôles sont globaux au cluster : « tester puis créer » n'est pas atomique, deux initialisations simultanées (tests en parallèle, plusieurs
-- bases sur un même serveur) se disputent la création. On tente de créer et on tolère « déjà créé » (42710) ou sa variante de course (23505).
DO $$ BEGIN
  CREATE ROLE ned_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
EXCEPTION WHEN duplicate_object OR unique_violation THEN
  NULL;
END $$;

-- Tenant courant ; échoue fermé (NULL => aucune ligne visible).
CREATE OR REPLACE FUNCTION app.current_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.user_id', true), '') $$;

CREATE TABLE tenant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  default_locale text NOT NULL DEFAULT 'fr' CHECK (default_locale IN ('fr','ar','en')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organisation (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  parent_id uuid,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'executing' CHECK (kind IN ('government','pmu','piu','donor','executing','ngo','consultant','other')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, parent_id) REFERENCES organisation(tenant_id, id)
);

CREATE TABLE program (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  code text NOT NULL,
  name jsonb NOT NULL,                      -- {"fr":"..","ar":"..","en":".."}
  owner_org_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, owner_org_id) REFERENCES organisation(tenant_id, id)
);

CREATE TABLE project (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  program_id uuid NOT NULL,
  code text NOT NULL,
  name jsonb NOT NULL,
  start_date date,
  end_date date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','suspended','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, program_id) REFERENCES program(tenant_id, id),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

CREATE TABLE component (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  code text NOT NULL,
  name jsonb NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, project_id, code),
  FOREIGN KEY (tenant_id, project_id) REFERENCES project(tenant_id, id)
);

-- Journal d'audit générique (append-only pour ned_app).
CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  actor text,
  table_name text NOT NULL,
  op text NOT NULL,
  row_id text,
  old_data jsonb,
  new_data jsonb
);
CREATE INDEX audit_log_tenant_at ON audit_log (tenant_id, at DESC);

CREATE OR REPLACE FUNCTION app.audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r jsonb := to_jsonb(COALESCE(NEW, OLD));
BEGIN
  INSERT INTO audit_log (tenant_id, actor, table_name, op, row_id, old_data, new_data)
  VALUES ((r->>'tenant_id')::uuid, app.current_user_id(), TG_TABLE_NAME, TG_OP, r->>'id',
          CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
          CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END);
  RETURN COALESCE(NEW, OLD);
END $$;

-- Applique RLS + audit + droits à une table portant tenant_id.
CREATE OR REPLACE FUNCTION app.secure_table(t regclass, audited boolean DEFAULT true) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %s USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant())', t);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO ned_app', t);
  IF audited THEN
    EXECUTE format('DROP TRIGGER IF EXISTS audit_trg ON %s', t);
    EXECUTE format('CREATE TRIGGER audit_trg AFTER INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION app.audit()', t);
  END IF;
END $$;

SELECT app.secure_table('organisation');
SELECT app.secure_table('program');
SELECT app.secure_table('project');
SELECT app.secure_table('component');

-- audit_log : lecture/insertion seulement, isolée par tenant.
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_log USING (tenant_id = app.current_tenant());
GRANT SELECT ON audit_log TO ned_app;

-- tenant : un utilisateur ne voit que le sien.
ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_self ON tenant USING (id = app.current_tenant());
GRANT SELECT ON tenant TO ned_app;
GRANT USAGE ON SCHEMA app TO ned_app;
GRANT EXECUTE ON FUNCTION app.current_tenant(), app.current_user_id() TO ned_app;
