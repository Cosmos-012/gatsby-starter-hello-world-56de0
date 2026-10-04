-- 009 MEAL : accountability (retours, plaintes, réclamations, suggestions, satisfaction) + apprentissage (leçons, bonnes pratiques, adaptations).

-- Rôles de l'appelant (posés par l'API en SET LOCAL) : permet des politiques RLS fondées sur le rôle.
CREATE OR REPLACE FUNCTION app.has_role(r text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT r = ANY (string_to_array(COALESCE(current_setting('app.roles', true), ''), ','))
$$;
GRANT EXECUTE ON FUNCTION app.has_role(text) TO ned_app;

CREATE TABLE feedback (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('feedback','complaint','grievance','suggestion','satisfaction')),
  channel text NOT NULL CHECK (channel IN ('hotline','box','sms','email','in_person','web','other')),
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','acknowledged','investigating','escalated','resolved','closed')),
  subject text NOT NULL,
  description text NOT NULL,
  anonymous boolean NOT NULL DEFAULT false,
  submitter_contact text,
  is_sensitive boolean NOT NULL DEFAULT false,         -- protection / abus : visible des seuls managers (RLS)
  satisfaction_score smallint,
  location text,
  received_at timestamptz NOT NULL DEFAULT now(),
  ack_due_at timestamptz,
  due_at timestamptz,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  resolution text,
  escalation_level int NOT NULL DEFAULT 0,
  escalated_to text,
  complainant_satisfied boolean,
  closed_at timestamptz,
  created_by text,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES project(tenant_id, id),
  CHECK ((kind = 'satisfaction') = (satisfaction_score IS NOT NULL)),
  CHECK (satisfaction_score IS NULL OR satisfaction_score BETWEEN 1 AND 5),
  CHECK (NOT anonymous OR submitter_contact IS NULL),
  CHECK (status NOT IN ('resolved') OR length(btrim(COALESCE(resolution,''))) >= 10),
  CHECK (status <> 'escalated' OR escalated_to IS NOT NULL),
  CHECK (status <> 'closed' OR closed_at IS NOT NULL)
);
CREATE INDEX feedback_open ON feedback (tenant_id, status, due_at);

CREATE TABLE feedback_event (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  feedback_id uuid NOT NULL,
  from_status text, to_status text NOT NULL,
  actor text NOT NULL, note text,
  at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, feedback_id) REFERENCES feedback(tenant_id, id)
);

CREATE TABLE lesson (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  category text NOT NULL CHECK (category IN ('lesson','good_practice','challenge','adaptation')),
  title text NOT NULL,
  description text NOT NULL,
  recommendation text,
  decision text,                                   -- adaptation : décision prise / action corrective
  tags text[] NOT NULL DEFAULT '{}',
  result_id uuid, evaluation_id uuid,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','validated','published')),
  created_by text, validated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES project(tenant_id, id),
  FOREIGN KEY (tenant_id, result_id) REFERENCES result(tenant_id, id),
  FOREIGN KEY (tenant_id, evaluation_id) REFERENCES evaluation(tenant_id, id),
  CHECK (category <> 'adaptation' OR length(btrim(COALESCE(decision,''))) >= 5)
);
CREATE INDEX lesson_search ON lesson USING gin (app.norm_text(title || ' ' || description) gin_trgm_ops);

-- Une leçon n'est validée que par quelqu'un d'autre que son auteur ; publication seulement après validation.
CREATE OR REPLACE FUNCTION app.enforce_lesson() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF (OLD.status, NEW.status) NOT IN (('draft','validated'),('validated','published'),('validated','draft')) THEN
    RAISE EXCEPTION 'invalid lesson transition % -> %', OLD.status, NEW.status USING ERRCODE = '23514'; END IF;
  IF NEW.status = 'validated' THEN
    IF OLD.created_by IS NOT DISTINCT FROM app.current_user_id() THEN
      RAISE EXCEPTION 'segregation of duties: author cannot validate' USING ERRCODE = '42501'; END IF;
    NEW.validated_by := app.current_user_id();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lesson_rules BEFORE UPDATE ON lesson FOR EACH ROW EXECUTE FUNCTION app.enforce_lesson();

SELECT app.secure_table('feedback');
SELECT app.secure_table('lesson');
SELECT app.secure_table('feedback_event', false);
-- Journal d'événements : insertion/lecture seulement.
REVOKE UPDATE, DELETE ON feedback_event FROM ned_app;
GRANT USAGE ON SEQUENCE feedback_event_id_seq TO ned_app;
REVOKE DELETE ON feedback, lesson FROM ned_app;

-- Retours sensibles : réservés aux managers, imposé par PostgreSQL (défense en profondeur).
DROP POLICY tenant_isolation ON feedback;
CREATE POLICY tenant_isolation ON feedback
  USING (tenant_id = app.current_tenant() AND (NOT is_sensitive OR app.has_role('admin') OR app.has_role('me_manager')))
  WITH CHECK (tenant_id = app.current_tenant());
DROP POLICY tenant_isolation ON feedback_event;
CREATE POLICY tenant_isolation ON feedback_event
  USING (tenant_id = app.current_tenant() AND EXISTS (SELECT 1 FROM feedback f WHERE f.tenant_id = feedback_event.tenant_id AND f.id = feedback_event.feedback_id))
  WITH CHECK (tenant_id = app.current_tenant());
