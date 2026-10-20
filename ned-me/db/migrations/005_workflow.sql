-- 005 Workflow de validation des valeurs : graphe appliqué en base, séparation des tâches, historique.
ALTER TABLE indicator_value ADD COLUMN submitted_by text;

CREATE TABLE workflow_event (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  value_id uuid NOT NULL,
  from_state text NOT NULL,
  to_state text NOT NULL,
  actor text NOT NULL,
  comment text,
  at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, value_id) REFERENCES indicator_value(tenant_id, id)
);
ALTER TABLE workflow_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_event FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workflow_event USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant());
GRANT SELECT, INSERT ON workflow_event TO ned_app;
GRANT USAGE ON SEQUENCE workflow_event_id_seq TO ned_app;

-- Transitions autorisées ; rejet => retour à draft. Le valideur ne peut pas être le soumissionnaire.
CREATE OR REPLACE FUNCTION app.enforce_value_workflow() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.workflow_state = OLD.workflow_state THEN RETURN NEW; END IF;
  IF NOT ((OLD.workflow_state, NEW.workflow_state) IN (
      ('draft','submitted'),('submitted','review'),('review','validated'),('validated','approved'),
      ('approved','published'),('published','archived'),
      ('submitted','draft'),('review','draft'),('validated','draft'))) THEN
    RAISE EXCEPTION 'invalid transition % -> %', OLD.workflow_state, NEW.workflow_state USING ERRCODE = '23514';
  END IF;
  IF NEW.workflow_state = 'submitted' THEN NEW.submitted_by := app.current_user_id(); END IF;
  IF NEW.workflow_state IN ('validated','approved') AND OLD.submitted_by IS NOT DISTINCT FROM app.current_user_id() THEN
    RAISE EXCEPTION 'segregation of duties: submitter cannot validate/approve' USING ERRCODE = '42501';
  END IF;
  INSERT INTO workflow_event (tenant_id, value_id, from_state, to_state, actor, comment)
  VALUES (NEW.tenant_id, NEW.id, OLD.workflow_state, NEW.workflow_state, COALESCE(app.current_user_id(),'unknown'), NULLIF(current_setting('app.comment', true), ''));
  RETURN NEW;
END $$;
CREATE TRIGGER value_workflow BEFORE UPDATE OF workflow_state ON indicator_value
  FOR EACH ROW EXECUTE FUNCTION app.enforce_value_workflow();
