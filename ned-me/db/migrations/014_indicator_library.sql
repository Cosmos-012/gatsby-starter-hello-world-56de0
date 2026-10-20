-- 014 Bibliothèque d'indicateurs de référence (fiches PIRS) : un indicateur, une définition, partagée entre projets du même client.
-- Un indicateur de projet COPIE les champs de la fiche à sa création (instantané) et garde le lien : modifier ou retirer la fiche ne change
-- jamais silencieusement un indicateur déjà suivi.

CREATE TABLE indicator_definition (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[A-Za-z0-9._-]{1,40}$'),
  title jsonb NOT NULL,
  definition jsonb,
  unit text,
  type text NOT NULL DEFAULT 'number' CHECK (type IN ('number','percentage','ratio','index','boolean')),
  direction text NOT NULL DEFAULT 'increase' CHECK (direction IN ('increase','decrease')),
  aggregation text NOT NULL DEFAULT 'latest' CHECK (aggregation IN ('sum','avg','latest','ratio')),
  frequency text NOT NULL DEFAULT 'quarterly' CHECK (frequency IN ('monthly','quarterly','semiannual','annual')),
  numerator_def text,
  denominator_def text,
  disaggregations text[] NOT NULL DEFAULT '{}' CHECK (cardinality(disaggregations) <= 20),
  sdg_target text CHECK (sdg_target IS NULL OR sdg_target ~ '^[0-9]{1,2}\.[0-9a-z]{1,2}(\.[0-9a-z]{1,2})?$'),
  iati_code text CHECK (iati_code IS NULL OR length(iati_code) BETWEEN 1 AND 60),
  data_source text,
  collection_method text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code),
  CHECK (type <> 'ratio' OR (numerator_def IS NOT NULL AND denominator_def IS NOT NULL))     -- un ratio sans numérateur ni dénominateur n'est pas calculable
);
SELECT app.secure_table('indicator_definition');

ALTER TABLE indicator ADD COLUMN definition_id uuid;
ALTER TABLE indicator ADD FOREIGN KEY (tenant_id, definition_id) REFERENCES indicator_definition(tenant_id, id);
