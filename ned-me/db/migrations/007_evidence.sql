-- 007 Preuves : métadonnées en base, fichiers en stockage S3-compatible (clé générée côté serveur, préfixée par le tenant).
CREATE TABLE evidence (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('photo','report','dataset','survey','certificate','attendance','document','evaluation_report','supporting','url')),
  title text NOT NULL,
  filename text,
  content_type text,
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes > 0),
  sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  storage_key text,
  url text,
  latitude numeric CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric CHECK (longitude BETWEEN -180 AND 180),
  captured_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','available')),
  uploaded_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES project(tenant_id, id),
  CHECK ((kind = 'url') = (url IS NOT NULL)),                       -- une preuve URL porte une URL, les autres un fichier
  CHECK (kind = 'url' OR (filename IS NOT NULL AND size_bytes IS NOT NULL AND storage_key IS NOT NULL)),
  CHECK ((latitude IS NULL) = (longitude IS NULL)),
  CHECK (url IS NULL OR url ~* '^https?://')
);

-- Un lien rattache la preuve à exactement une cible : donnée (valeur), indicateur, résultat ou projet.
CREATE TABLE evidence_link (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  evidence_id uuid NOT NULL,
  indicator_value_id uuid,
  indicator_id uuid,
  result_id uuid,
  linked_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, evidence_id) REFERENCES evidence(tenant_id, id),
  FOREIGN KEY (tenant_id, indicator_value_id) REFERENCES indicator_value(tenant_id, id),
  FOREIGN KEY (tenant_id, indicator_id) REFERENCES indicator(tenant_id, id),
  FOREIGN KEY (tenant_id, result_id) REFERENCES result(tenant_id, id),
  CHECK (num_nonnulls(indicator_value_id, indicator_id, result_id) = 1)
);
CREATE UNIQUE INDEX evidence_link_uniq ON evidence_link
  (tenant_id, evidence_id, COALESCE(indicator_value_id, indicator_id, result_id));
CREATE INDEX evidence_link_value ON evidence_link (tenant_id, indicator_value_id) WHERE indicator_value_id IS NOT NULL;
CREATE INDEX evidence_link_indicator ON evidence_link (tenant_id, indicator_id) WHERE indicator_id IS NOT NULL;

SELECT app.secure_table('evidence');
SELECT app.secure_table('evidence_link');
-- Les preuves ne se suppriment pas (traçabilité) : retrait du droit DELETE pour l'application.
REVOKE DELETE ON evidence, evidence_link FROM ned_app;
