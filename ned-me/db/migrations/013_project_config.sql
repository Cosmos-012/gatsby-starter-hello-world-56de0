-- 013 Configuration par projet (low-code) : modules actifs, terminologie, tableau de bord, champs personnalisés des indicateurs.
-- Le schéma reste unique pour tous les projets ; ce qui varie selon la nature du projet est de la donnée validée, pas du code.

ALTER TABLE indicator ADD COLUMN attributes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object' AND length(attributes::text) <= 20000);

CREATE TABLE project_config (
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  id uuid GENERATED ALWAYS AS (project_id) STORED,          -- clé de traçabilité pour le journal d'audit
  template text NOT NULL DEFAULT 'generic' CHECK (template ~ '^[a-z_]{2,40}$'),
  modules jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(modules) = 'object'),
  terminology jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(terminology) = 'object'),
  dashboard jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(dashboard) = 'object'),
  custom_fields jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(custom_fields) = 'array' AND jsonb_array_length(custom_fields) <= 40),
  version int NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  PRIMARY KEY (tenant_id, project_id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES project(tenant_id, id) ON DELETE CASCADE,
  CHECK (length(modules::text) + length(terminology::text) + length(dashboard::text) + length(custom_fields::text) <= 60000)
);
SELECT app.secure_table('project_config');
