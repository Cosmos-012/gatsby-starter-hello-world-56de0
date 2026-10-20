-- 011 Risques et problèmes : registre, probabilité × impact, atténuation, escalade, historique d'évaluation, liens résultats/indicateurs.
CREATE TABLE risk (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  code text NOT NULL,
  title text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'other' CHECK (category IN ('strategic','operational','financial','procurement','technical','political','environmental_social','other')),
  probability smallint NOT NULL CHECK (probability BETWEEN 1 AND 5),
  impact smallint NOT NULL CHECK (impact BETWEEN 1 AND 5),
  score smallint GENERATED ALWAYS AS (probability * impact) STORED,
  level text GENERATED ALWAYS AS (CASE WHEN probability * impact >= 15 THEN 'critical' WHEN probability * impact >= 10 THEN 'high'
                                        WHEN probability * impact >= 5 THEN 'medium' ELSE 'low' END) STORED,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','mitigating','accepted','materialized','closed')),
  owner_name text NOT NULL,
  owner_user text,
  review_due date,
  escalation_level smallint NOT NULL DEFAULT 0 CHECK (escalation_level BETWEEN 0 AND 3),
  escalated_to text,
  accepted_rationale text,
  closure_note text,
  closed_at timestamptz,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, project_id, code),
  FOREIGN KEY (tenant_id, project_id) REFERENCES project(tenant_id, id),
  CHECK (escalation_level = 0 OR escalated_to IS NOT NULL),
  CHECK (status <> 'closed' OR closed_at IS NOT NULL)
);
CREATE TABLE risk_result (
  tenant_id uuid NOT NULL, risk_id uuid NOT NULL, result_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, risk_id, result_id),
  FOREIGN KEY (tenant_id, risk_id) REFERENCES risk(tenant_id, id),
  FOREIGN KEY (tenant_id, result_id) REFERENCES result(tenant_id, id)
);
CREATE TABLE risk_indicator (
  tenant_id uuid NOT NULL, risk_id uuid NOT NULL, indicator_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, risk_id, indicator_id),
  FOREIGN KEY (tenant_id, risk_id) REFERENCES risk(tenant_id, id),
  FOREIGN KEY (tenant_id, indicator_id) REFERENCES indicator(tenant_id, id)
);
CREATE TABLE risk_mitigation (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  risk_id uuid NOT NULL,
  description text NOT NULL,
  responsible_name text NOT NULL,
  responsible_user text,
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
  completion_note text, completed_at timestamptz,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, risk_id) REFERENCES risk(tenant_id, id),
  CHECK (status = 'open' OR length(btrim(COALESCE(completion_note,''))) >= 3)
);
CREATE TABLE risk_assessment (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  risk_id uuid NOT NULL,
  probability smallint NOT NULL, impact smallint NOT NULL, score smallint NOT NULL,
  actor text, note text, at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, risk_id) REFERENCES risk(tenant_id, id)
);

CREATE TABLE issue (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  risk_id uuid,
  title text NOT NULL,
  description text,
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','escalated','resolved','closed')),
  owner_name text NOT NULL,
  owner_user text,
  due_date date NOT NULL,
  escalation_level smallint NOT NULL DEFAULT 0 CHECK (escalation_level BETWEEN 0 AND 3),
  escalated_to text,
  resolution text,
  closed_at timestamptz,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES project(tenant_id, id),
  FOREIGN KEY (tenant_id, risk_id) REFERENCES risk(tenant_id, id),
  CHECK (escalation_level = 0 OR escalated_to IS NOT NULL),
  CHECK (status NOT IN ('resolved','closed') OR length(btrim(COALESCE(resolution,''))) >= 10),
  CHECK (status <> 'closed' OR closed_at IS NOT NULL)
);
CREATE INDEX risk_open ON risk (tenant_id, project_id, status);
CREATE INDEX issue_open ON issue (tenant_id, project_id, status, due_date);

-- Règles du registre des risques, appliquées en base.
CREATE OR REPLACE FUNCTION app.enforce_risk() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE crit boolean := NEW.probability * NEW.impact >= 15;
BEGIN
  IF OLD.status = 'closed' THEN RAISE EXCEPTION 'risk is closed' USING ERRCODE = '23514'; END IF;
  IF NEW.status <> OLD.status THEN
    IF NOT ((OLD.status, NEW.status) IN (('open','mitigating'),('open','accepted'),('open','closed'),('open','materialized'),
        ('mitigating','open'),('mitigating','accepted'),('mitigating','closed'),('mitigating','materialized'),
        ('accepted','mitigating'),('accepted','closed'),('accepted','materialized'),('materialized','closed'))) THEN
      RAISE EXCEPTION 'invalid risk transition % -> %', OLD.status, NEW.status USING ERRCODE = '23514'; END IF;
    IF NEW.status = 'mitigating' AND NOT EXISTS (SELECT 1 FROM risk_mitigation WHERE tenant_id = NEW.tenant_id AND risk_id = NEW.id AND status <> 'cancelled') THEN
      RAISE EXCEPTION 'cannot mitigate without a mitigation action' USING ERRCODE = '23514'; END IF;
    IF NEW.status = 'accepted' THEN
      IF length(btrim(COALESCE(NEW.accepted_rationale,''))) < 10 THEN RAISE EXCEPTION 'acceptance rationale required' USING ERRCODE = '23514'; END IF;
      IF crit AND NEW.escalation_level < 1 THEN RAISE EXCEPTION 'a critical risk must be escalated before acceptance' USING ERRCODE = '23514'; END IF;
    END IF;
    IF NEW.status = 'closed' THEN
      IF length(btrim(COALESCE(NEW.closure_note,''))) < 5 THEN RAISE EXCEPTION 'closure note required' USING ERRCODE = '23514'; END IF;
      IF EXISTS (SELECT 1 FROM risk_mitigation WHERE tenant_id = NEW.tenant_id AND risk_id = NEW.id AND status = 'open') THEN
        RAISE EXCEPTION 'cannot close: open mitigation actions remain' USING ERRCODE = '23514'; END IF;
    END IF;
  END IF;
  IF NEW.escalation_level < OLD.escalation_level THEN RAISE EXCEPTION 'escalation cannot be lowered' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER risk_rules BEFORE UPDATE ON risk FOR EACH ROW EXECUTE FUNCTION app.enforce_risk();

CREATE OR REPLACE FUNCTION app.enforce_mitigation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM risk WHERE tenant_id = NEW.tenant_id AND id = NEW.risk_id;
  IF st IN ('closed') THEN RAISE EXCEPTION 'risk is closed' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER mitigation_rules BEFORE INSERT ON risk_mitigation FOR EACH ROW EXECUTE FUNCTION app.enforce_mitigation();

-- Historique des évaluations (probabilité × impact) : une ligne à la création et à chaque changement.
CREATE OR REPLACE FUNCTION app.log_risk_assessment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.probability <> OLD.probability OR NEW.impact <> OLD.impact THEN
    INSERT INTO risk_assessment (tenant_id, risk_id, probability, impact, score, actor, note)
    VALUES (NEW.tenant_id, NEW.id, NEW.probability, NEW.impact, NEW.probability * NEW.impact, app.current_user_id(), NULLIF(current_setting('app.comment', true), ''));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER risk_assessment_log AFTER INSERT OR UPDATE ON risk FOR EACH ROW EXECUTE FUNCTION app.log_risk_assessment();

CREATE OR REPLACE FUNCTION app.enforce_issue() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'closed' THEN RAISE EXCEPTION 'issue is closed' USING ERRCODE = '23514'; END IF;
  IF NEW.status <> OLD.status AND NOT ((OLD.status, NEW.status) IN (('open','in_progress'),('open','escalated'),('open','resolved'),
      ('in_progress','escalated'),('in_progress','resolved'),('escalated','in_progress'),('escalated','resolved'),('resolved','closed'),('resolved','in_progress'))) THEN
    RAISE EXCEPTION 'invalid issue transition % -> %', OLD.status, NEW.status USING ERRCODE = '23514'; END IF;
  IF NEW.escalation_level < OLD.escalation_level THEN RAISE EXCEPTION 'escalation cannot be lowered' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER issue_rules BEFORE UPDATE ON issue FOR EACH ROW EXECUTE FUNCTION app.enforce_issue();

-- Un problème ne peut pas se rattacher à un risque clos (un risque clos est figé).
CREATE OR REPLACE FUNCTION app.enforce_issue_risk() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.risk_id IS NOT NULL AND EXISTS (SELECT 1 FROM risk WHERE tenant_id = NEW.tenant_id AND id = NEW.risk_id AND status = 'closed') THEN
    RAISE EXCEPTION 'cannot link an issue to a closed risk' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER issue_risk_rules BEFORE INSERT ON issue FOR EACH ROW EXECUTE FUNCTION app.enforce_issue_risk();

SELECT app.secure_table('risk');
SELECT app.secure_table('risk_result');
SELECT app.secure_table('risk_indicator');
SELECT app.secure_table('risk_mitigation');
SELECT app.secure_table('issue');
SELECT app.secure_table('risk_assessment', false);
REVOKE UPDATE, DELETE ON risk_assessment FROM ned_app;
GRANT USAGE ON SEQUENCE risk_assessment_id_seq TO ned_app;
REVOKE DELETE ON risk, issue, risk_mitigation FROM ned_app;
