-- 010 Rapports : instantané immuable (contenu + empreinte SHA-256), versions, workflow Draft→…→Archived, historique.
CREATE TABLE report (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  project_id uuid,
  type text NOT NULL CHECK (type IN ('monthly','quarterly','semiannual','annual','donor','government','executive','me','meal','indicator','dqa','evaluation')),
  title text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  as_of date NOT NULL,
  version int NOT NULL CHECK (version >= 1),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','review','validated','approved','published','archived')),
  content jsonb NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  generated_by text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES project(tenant_id, id),
  CHECK (period_end >= period_start)
);
-- Une version par (projet, type, fin de période) ; les rapports sans projet partagent la clé '' via COALESCE.
CREATE UNIQUE INDEX report_version_uniq ON report (tenant_id, COALESCE(project_id::text, ''), type, period_end, version);
CREATE INDEX report_lookup ON report (tenant_id, project_id, type, status);

CREATE TABLE report_event (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  report_id uuid NOT NULL,
  from_status text NOT NULL, to_status text NOT NULL,
  actor text NOT NULL, comment text,
  at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, report_id) REFERENCES report(tenant_id, id)
);

CREATE OR REPLACE FUNCTION app.enforce_report() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Le contenu est un instantané : jamais modifié (régénérer crée une nouvelle version).
  IF NEW.content IS DISTINCT FROM OLD.content OR NEW.content_hash <> OLD.content_hash OR NEW.type <> OLD.type
     OR NEW.version <> OLD.version OR NEW.period_end <> OLD.period_end OR NEW.period_start <> OLD.period_start
     OR NEW.as_of <> OLD.as_of OR NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.generated_by <> OLD.generated_by THEN
    RAISE EXCEPTION 'report content is immutable; generate a new version' USING ERRCODE = '23514'; END IF;
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF (OLD.status, NEW.status) NOT IN (('draft','submitted'),('submitted','review'),('review','validated'),('validated','approved'),
      ('approved','published'),('published','archived'),('submitted','draft'),('review','draft'),('validated','draft')) THEN
    RAISE EXCEPTION 'invalid transition % -> %', OLD.status, NEW.status USING ERRCODE = '23514'; END IF;
  IF NEW.status IN ('validated','approved') AND OLD.generated_by = app.current_user_id() THEN
    RAISE EXCEPTION 'segregation of duties: the author cannot validate/approve' USING ERRCODE = '42501'; END IF;
  INSERT INTO report_event (tenant_id, report_id, from_status, to_status, actor, comment)
  VALUES (NEW.tenant_id, NEW.id, OLD.status, NEW.status, COALESCE(app.current_user_id(), 'unknown'), NULLIF(current_setting('app.comment', true), ''));
  RETURN NEW;
END $$;
CREATE TRIGGER report_rules BEFORE UPDATE ON report FOR EACH ROW EXECUTE FUNCTION app.enforce_report();

SELECT app.secure_table('report');
SELECT app.secure_table('report_event', false);
REVOKE DELETE ON report FROM ned_app;
REVOKE UPDATE, DELETE ON report_event FROM ned_app;
GRANT USAGE ON SEQUENCE report_event_id_seq TO ned_app;
