-- 012 Accès BI (Superset, Metabase, tout outil qui permet d'écrire du SQL).
-- Le cloisonnement de l'API repose sur un paramètre de session (app.tenant_id) : un rôle qui exécute du SQL libre peut le modifier lui-même
-- et lire un autre tenant (démontré). Un compte BI n'a donc AUCUN accès aux tables : il lit uniquement des vues du schéma « bi », filtrées
-- par son identité de connexion (session_user), qu'aucune instruction SQL ne peut changer sans être superuser.
CREATE SCHEMA IF NOT EXISTS bi;

DO $$ BEGIN CREATE ROLE ned_bi_reader NOLOGIN NOSUPERUSER NOBYPASSRLS;
EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$;

-- Correspondance compte de connexion → tenant. Aucun droit pour ned_app ni ned_bi_reader.
CREATE TABLE bi_account (
  role_name text PRIMARY KEY CHECK (role_name ~ '^bi_[a-z0-9_]{1,40}$'),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON bi_account FROM PUBLIC;

-- session_user : identité de la connexion, inchangeable par SET ROLE ni par SET d'un paramètre (current_user serait celui du propriétaire ici).
CREATE OR REPLACE FUNCTION app.bi_tenant() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT tenant_id FROM public.bi_account WHERE role_name = session_user
$$;
REVOKE ALL ON FUNCTION app.bi_tenant() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.bi_tenant() TO ned_bi_reader;

-- Vues : propriétaire privilégié (les tables sont sous RLS forcée), filtre explicite, security_barrier pour qu'une fonction écrite par
-- l'utilisateur ne soit jamais évaluée sur des lignes d'un autre tenant. Aucune donnée personnelle ni signalement sensible.
CREATE VIEW bi.projects WITH (security_barrier = true) AS
  SELECT p.id, p.code, p.name, p.start_date, p.end_date, p.status, g.code AS program_code, g.name AS program_name
  FROM project p JOIN program g ON g.tenant_id = p.tenant_id AND g.id = p.program_id WHERE p.tenant_id = app.bi_tenant();
CREATE VIEW bi.results WITH (security_barrier = true) AS
  SELECT r.id, r.project_id, r.level, r.code, r.name, r.parent_id FROM result r WHERE r.tenant_id = app.bi_tenant();
CREATE VIEW bi.indicators WITH (security_barrier = true) AS
  SELECT i.id, i.project_id, i.result_id, i.code, i.name, i.unit, i.type, i.direction, i.frequency, i.baseline, i.verification_status
  FROM indicator i WHERE i.tenant_id = app.bi_tenant();
CREATE VIEW bi.indicator_values WITH (security_barrier = true) AS         -- uniquement les valeurs validées
  SELECT v.id, v.indicator_id, v.period, v.period_end, v.kind, v.value, v.dimensions, v.workflow_state
  FROM indicator_value v WHERE v.tenant_id = app.bi_tenant() AND v.workflow_state IN ('validated','approved','published');
-- Même calcul que v_indicator_progress (002), réécrit sur les tables : la vue de l'API est security_invoker, un mode qui s'étend au compte BI
-- à travers cette vue (« permission denied for table status_config »). Le test bi_test.sh compare les deux résultats pour interdire toute dérive.
CREATE VIEW bi.indicator_progress WITH (security_barrier = true) AS
WITH last_actual AS (
  SELECT DISTINCT ON (v.indicator_id) v.indicator_id, v.period, v.value AS actual
  FROM indicator_value v
  WHERE v.tenant_id = app.bi_tenant() AND v.kind = 'actual' AND v.dimensions = '{}' AND v.workflow_state IN ('validated','approved','published')
  ORDER BY v.indicator_id, v.period_end DESC
), calc AS (
  SELECT i.id AS indicator_id, i.project_id, i.code, i.tenant_id, la.period, la.actual, t.value AS target,
         CASE
           WHEN la.actual IS NULL OR t.value IS NULL THEN NULL
           WHEN i.direction = 'increase' AND t.value <> COALESCE(i.baseline,0) THEN (la.actual - COALESCE(i.baseline,0)) / (t.value - COALESCE(i.baseline,0))
           WHEN i.direction = 'decrease' AND COALESCE(i.baseline,0) <> t.value THEN (COALESCE(i.baseline,0) - la.actual) / (COALESCE(i.baseline,0) - t.value)
           ELSE NULL
         END AS achievement
  FROM indicator i
  LEFT JOIN last_actual la ON la.indicator_id = i.id
  LEFT JOIN indicator_value t ON t.tenant_id = i.tenant_id AND t.indicator_id = i.id AND t.kind = 'target' AND t.dimensions = '{}' AND t.period = la.period
  WHERE i.tenant_id = app.bi_tenant()
)
SELECT c.indicator_id, c.project_id, c.code, c.period, c.actual, c.target, c.actual - c.target AS gap, c.achievement,
       CASE WHEN c.achievement IS NULL THEN 'GREY'
            WHEN c.achievement >= COALESCE(sc.green_min, 0.90) THEN 'GREEN'
            WHEN c.achievement >= COALESCE(sc.amber_min, 0.60) THEN 'AMBER'
            ELSE 'RED' END AS status
FROM calc c LEFT JOIN status_config sc ON sc.tenant_id = c.tenant_id;
CREATE VIEW bi.risks WITH (security_barrier = true) AS
  SELECT r.id, r.project_id, r.code, r.title, r.category, r.probability, r.impact, r.score, r.level, r.status, r.review_due, r.escalation_level
  FROM risk r WHERE r.tenant_id = app.bi_tenant();
CREATE VIEW bi.issues WITH (security_barrier = true) AS
  SELECT i.id, i.project_id, i.risk_id, i.title, i.severity, i.status, i.due_date, i.escalation_level
  FROM issue i WHERE i.tenant_id = app.bi_tenant();
CREATE VIEW bi.feedback WITH (security_barrier = true) AS                 -- ni texte, ni contact, ni signalement sensible
  SELECT f.id, f.project_id, f.kind, f.channel, f.severity, f.status, f.received_at, f.ack_due_at, f.due_at, f.acknowledged_at, f.resolved_at,
         f.satisfaction_score, f.escalation_level
  FROM feedback f WHERE f.tenant_id = app.bi_tenant() AND NOT f.is_sensitive;
CREATE VIEW bi.recommendations WITH (security_barrier = true) AS
  SELECT r.id, e.project_id, e.id AS evaluation_id, e.type AS evaluation_type, e.status AS evaluation_status, r.priority, r.status, r.response_type
  FROM recommendation r JOIN evaluation e ON e.tenant_id = r.tenant_id AND e.id = r.evaluation_id WHERE r.tenant_id = app.bi_tenant();
CREATE VIEW bi.dq_issues WITH (security_barrier = true) AS
  SELECT d.id, d.indicator_id, d.period, d.dimension, d.code, d.severity, d.status FROM dq_issue d WHERE d.tenant_id = app.bi_tenant();
CREATE VIEW bi.lessons WITH (security_barrier = true) AS                  -- uniquement les leçons publiées
  SELECT l.id, l.project_id, l.category, l.title, l.tags, l.created_at FROM lesson l WHERE l.tenant_id = app.bi_tenant() AND l.status = 'published';

GRANT USAGE ON SCHEMA bi TO ned_bi_reader;
-- Le planificateur évalue, avec les droits de l'appelant, les fonctions des index d'expression (recherche arabe : app.norm_text / app.search_text)
-- pour estimer la sélectivité : sans ces droits, toute vue sur indicator / result / lesson échoue (« permission denied for schema app »).
GRANT USAGE ON SCHEMA app TO ned_bi_reader;
GRANT EXECUTE ON FUNCTION app.norm_text(text), app.search_text(jsonb) TO ned_bi_reader;
-- Hygiène : les fonctions d'administration n'ont pas à être appelables par PUBLIC (elles échouaient déjà faute de propriété).
REVOKE EXECUTE ON FUNCTION app.secure_table(regclass, boolean) FROM PUBLIC;
GRANT SELECT ON ALL TABLES IN SCHEMA bi TO ned_bi_reader;

-- Création d'un compte BI : réservée au propriétaire (aucun droit accordé à PUBLIC).
CREATE OR REPLACE FUNCTION app.create_bi_account(p_role text, p_tenant uuid, p_password text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_role !~ '^bi_[a-z0-9_]{1,40}$' THEN RAISE EXCEPTION 'invalid role name %', p_role USING ERRCODE = '22023'; END IF;
  IF length(p_password) < 12 THEN RAISE EXCEPTION 'password too short (12+ characters)' USING ERRCODE = '22023'; END IF;
  EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE CONNECTION LIMIT 5 IN ROLE ned_bi_reader', p_role, p_password);
  -- lecture seule, requêtes bornées : un tableau de bord ne doit pas pouvoir saturer la base
  EXECUTE format('ALTER ROLE %I SET default_transaction_read_only = on', p_role);
  EXECUTE format('ALTER ROLE %I SET statement_timeout = ''30s''', p_role);
  INSERT INTO bi_account (role_name, tenant_id) VALUES (p_role, p_tenant);
END $$;
REVOKE ALL ON FUNCTION app.create_bi_account(text, uuid, text) FROM PUBLIC;

-- Suppression d'un compte BI : retire le rôle ET sa correspondance (une correspondance orpheline serait héritée par un futur rôle de même nom).
CREATE OR REPLACE FUNCTION app.drop_bi_account(p_role text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_role !~ '^bi_[a-z0-9_]{1,40}$' THEN RAISE EXCEPTION 'invalid role name %', p_role USING ERRCODE = '22023'; END IF;
  DELETE FROM bi_account WHERE role_name = p_role;
  EXECUTE format('DROP ROLE IF EXISTS %I', p_role);
END $$;
REVOKE ALL ON FUNCTION app.drop_bi_account(text) FROM PUBLIC;
