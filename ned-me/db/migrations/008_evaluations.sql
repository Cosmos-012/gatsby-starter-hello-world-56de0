-- 008 Évaluations, questions, constats, recommandations, réponse du management, plan d'actions, clôture.
CREATE TABLE evaluation (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  title text NOT NULL,
  type text NOT NULL CHECK (type IN ('baseline','midterm','endterm','impact','outcome','process','thematic','rapid')),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','ongoing','report_draft','completed','cancelled')),
  planned_start date, planned_end date,
  methodology text, scope text, sampling text,
  evaluator_org_id uuid,
  report_evidence_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES project(tenant_id, id),
  FOREIGN KEY (tenant_id, evaluator_org_id) REFERENCES organisation(tenant_id, id),
  FOREIGN KEY (tenant_id, report_evidence_id) REFERENCES evidence(tenant_id, id),
  CHECK (planned_end IS NULL OR planned_start IS NULL OR planned_end >= planned_start)
);
CREATE TABLE evaluation_question (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  evaluation_id uuid NOT NULL,
  position int NOT NULL DEFAULT 0,
  text text NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, evaluation_id) REFERENCES evaluation(tenant_id, id)
);
CREATE TABLE finding (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  evaluation_id uuid NOT NULL,
  question_id uuid,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, evaluation_id) REFERENCES evaluation(tenant_id, id),
  FOREIGN KEY (tenant_id, question_id) REFERENCES evaluation_question(tenant_id, id)
);
CREATE TABLE recommendation (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  evaluation_id uuid NOT NULL,
  finding_id uuid,
  text text NOT NULL,
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('high','medium','low')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','responded','in_progress','closed')),
  response_type text CHECK (response_type IN ('accepted','partially_accepted','rejected')),
  response_text text,
  responded_by text, responded_at timestamptz,
  closed_by text, closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, evaluation_id) REFERENCES evaluation(tenant_id, id),
  FOREIGN KEY (tenant_id, finding_id) REFERENCES finding(tenant_id, id),
  CHECK (status = 'open' OR (response_type IS NOT NULL AND length(btrim(COALESCE(response_text,''))) >= 5)),
  CHECK (status <> 'closed' OR closed_at IS NOT NULL)
);
CREATE TABLE recommendation_action (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  recommendation_id uuid NOT NULL,
  description text NOT NULL,
  responsible_name text NOT NULL,
  responsible_user text,
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
  completion_note text, completed_at timestamptz,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, recommendation_id) REFERENCES recommendation(tenant_id, id),
  CHECK (status = 'open' OR length(btrim(COALESCE(completion_note,''))) >= 3)
);
CREATE INDEX rec_action_due ON recommendation_action (tenant_id, due_date) WHERE status = 'open';

-- Règles métier appliquées en base.
CREATE OR REPLACE FUNCTION app.enforce_recommendation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'closed' AND (NEW.status <> 'closed' OR NEW.response_type IS DISTINCT FROM OLD.response_type) THEN
    RAISE EXCEPTION 'recommendation is closed' USING ERRCODE = '23514'; END IF;
  IF NEW.status = 'closed' AND OLD.status <> 'closed' AND NEW.response_type <> 'rejected' THEN
    IF NOT EXISTS (SELECT 1 FROM recommendation_action WHERE tenant_id = NEW.tenant_id AND recommendation_id = NEW.id AND status = 'done') THEN
      RAISE EXCEPTION 'cannot close: no completed action' USING ERRCODE = '23514'; END IF;
    IF EXISTS (SELECT 1 FROM recommendation_action WHERE tenant_id = NEW.tenant_id AND recommendation_id = NEW.id AND status = 'open') THEN
      RAISE EXCEPTION 'cannot close: open actions remain' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER rec_rules BEFORE UPDATE ON recommendation FOR EACH ROW EXECUTE FUNCTION app.enforce_recommendation();

CREATE OR REPLACE FUNCTION app.enforce_action() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  SELECT status, response_type INTO r FROM recommendation WHERE tenant_id = NEW.tenant_id AND id = NEW.recommendation_id;
  IF r.status = 'open' THEN RAISE EXCEPTION 'management response required before actions' USING ERRCODE = '23514'; END IF;
  IF r.status = 'closed' THEN RAISE EXCEPTION 'recommendation is closed' USING ERRCODE = '23514'; END IF;
  IF r.response_type = 'rejected' THEN RAISE EXCEPTION 'rejected recommendation takes no actions' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER action_rules BEFORE INSERT ON recommendation_action FOR EACH ROW EXECUTE FUNCTION app.enforce_action();

-- Une évaluation terminée doit avoir au moins un constat.
CREATE OR REPLACE FUNCTION app.enforce_evaluation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status <> 'completed'
     AND NOT EXISTS (SELECT 1 FROM finding WHERE tenant_id = NEW.tenant_id AND evaluation_id = NEW.id) THEN
    RAISE EXCEPTION 'cannot complete: no findings' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER eval_rules BEFORE UPDATE ON evaluation FOR EACH ROW EXECUTE FUNCTION app.enforce_evaluation();

SELECT app.secure_table('evaluation');
SELECT app.secure_table('evaluation_question');
SELECT app.secure_table('finding');
SELECT app.secure_table('recommendation');
SELECT app.secure_table('recommendation_action');
