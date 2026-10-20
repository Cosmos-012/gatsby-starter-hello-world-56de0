-- 006 DQA : règles par indicateur, anomalies détectées, actions correctives. Écrit par l'API, journalisé.
CREATE TABLE dq_rule (
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  indicator_id uuid NOT NULL,
  min_value numeric,
  max_value numeric,
  max_change_ratio numeric CHECK (max_change_ratio IS NULL OR max_change_ratio > 0),  -- variation relative max entre deux périodes
  grace_days int NOT NULL DEFAULT 30 CHECK (grace_days >= 0),
  PRIMARY KEY (tenant_id, indicator_id),
  FOREIGN KEY (tenant_id, indicator_id) REFERENCES indicator(tenant_id, id) ON DELETE CASCADE,
  CHECK (min_value IS NULL OR max_value IS NULL OR min_value <= max_value)
);

CREATE TABLE dq_issue (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  indicator_id uuid NOT NULL,
  period text NOT NULL DEFAULT '',
  dimension text NOT NULL CHECK (dimension IN ('accuracy','completeness','consistency','timeliness','validity','reliability')),
  code text NOT NULL,                        -- ex. out_of_range, spike, missing_period, overdue, no_target, slice_sum_mismatch, repeated_value, unverified, no_source
  severity text NOT NULL CHECK (severity IN ('error','warning')),
  message text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','waived')),
  corrective_action text,
  resolved_by text,
  resolved_at timestamptz,
  detected_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, indicator_id, period, code),   -- idempotence des ré-exécutions
  FOREIGN KEY (tenant_id, indicator_id) REFERENCES indicator(tenant_id, id) ON DELETE CASCADE,
  CHECK (status = 'open' OR corrective_action IS NOT NULL)   -- clore exige une action/justification
);
CREATE INDEX dq_issue_open ON dq_issue (tenant_id, status, indicator_id);

SELECT app.secure_table('dq_rule');
SELECT app.secure_table('dq_issue');
