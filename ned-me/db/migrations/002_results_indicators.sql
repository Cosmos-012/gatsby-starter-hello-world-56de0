-- 002 Cadre de résultats + moteur d'indicateurs (inspiré des concepts DHIS2 : indicateur, période, désagrégation)

CREATE TABLE result (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  component_id uuid,
  parent_id uuid,
  level text NOT NULL CHECK (level IN ('impact','outcome','output','activity')),
  code text NOT NULL,
  name jsonb NOT NULL,
  description jsonb,
  assumptions jsonb,                        -- hypothèses
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, project_id, code),
  FOREIGN KEY (tenant_id, project_id) REFERENCES project(tenant_id, id),
  FOREIGN KEY (tenant_id, component_id) REFERENCES component(tenant_id, id),
  FOREIGN KEY (tenant_id, parent_id) REFERENCES result(tenant_id, id)
);

-- Hiérarchie : un résultat ne peut avoir pour parent qu'un niveau supérieur.
CREATE OR REPLACE FUNCTION app.check_result_parent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rank_of jsonb := '{"impact":1,"outcome":2,"output":3,"activity":4}';
        p_level text;
BEGIN
  IF NEW.parent_id IS NULL THEN RETURN NEW; END IF;
  SELECT level INTO p_level FROM result WHERE tenant_id = NEW.tenant_id AND id = NEW.parent_id;
  IF (rank_of->>p_level)::int >= (rank_of->>NEW.level)::int THEN
    RAISE EXCEPTION 'result level % cannot be child of %', NEW.level, p_level USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER result_parent_chk BEFORE INSERT OR UPDATE ON result
  FOR EACH ROW EXECUTE FUNCTION app.check_result_parent();

CREATE TABLE indicator (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  result_id uuid,
  code text NOT NULL,
  name jsonb NOT NULL,
  definition jsonb,
  unit text,
  type text NOT NULL DEFAULT 'number' CHECK (type IN ('number','percentage','ratio','index','boolean')),
  direction text NOT NULL DEFAULT 'increase' CHECK (direction IN ('increase','decrease')),
  frequency text NOT NULL DEFAULT 'quarterly' CHECK (frequency IN ('monthly','quarterly','semiannual','annual')),
  numerator_def text,
  denominator_def text,
  data_source text,
  collection_method text,
  responsible_org_id uuid,
  verification_status text NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified','verified','disputed')),
  baseline numeric,
  baseline_period text,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, project_id, code),
  FOREIGN KEY (tenant_id, project_id) REFERENCES project(tenant_id, id),
  FOREIGN KEY (tenant_id, result_id) REFERENCES result(tenant_id, id),
  FOREIGN KEY (tenant_id, responsible_org_id) REFERENCES organisation(tenant_id, id)
);

-- Cibles et valeurs réelles par période (ex. '2026-Q1'), avec dimension de désagrégation libre.
CREATE TABLE indicator_value (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  indicator_id uuid NOT NULL,
  period text NOT NULL,
  period_end date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('target','actual')),
  dimensions jsonb NOT NULL DEFAULT '{}',   -- ex. {"sex":"F","region":"Nord"} : taxonomie jamais imposée
  value numeric NOT NULL,
  workflow_state text NOT NULL DEFAULT 'draft'
    CHECK (workflow_state IN ('draft','submitted','review','validated','approved','published','archived')),
  comment text,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, indicator_id, period, kind, dimensions),
  FOREIGN KEY (tenant_id, indicator_id) REFERENCES indicator(tenant_id, id)
);
CREATE INDEX indicator_value_lookup ON indicator_value (tenant_id, indicator_id, period_end);

-- Seuils de statut configurables par tenant (VERT / AMBRE / ROUGE / GRIS).
CREATE TABLE status_config (
  tenant_id uuid PRIMARY KEY REFERENCES tenant(id) ON DELETE CASCADE,
  green_min numeric NOT NULL DEFAULT 0.90,
  amber_min numeric NOT NULL DEFAULT 0.60,
  CHECK (amber_min < green_min)
);

SELECT app.secure_table('result');
SELECT app.secure_table('indicator');
SELECT app.secure_table('indicator_value');
SELECT app.secure_table('status_config');

-- Progression par indicateur : dernier actual publié/validé vs cible de la même période (totaux, sans dimension).
-- security_invoker => RLS de l'appelant appliquée.
CREATE VIEW v_indicator_progress WITH (security_invoker = true) AS
WITH last_actual AS (
  SELECT DISTINCT ON (tenant_id, indicator_id) tenant_id, indicator_id, period, value AS actual
  FROM indicator_value
  WHERE kind = 'actual' AND dimensions = '{}' AND workflow_state IN ('validated','approved','published')
  ORDER BY tenant_id, indicator_id, period_end DESC
), calc AS (
  SELECT i.tenant_id, i.id AS indicator_id, i.project_id, i.code, i.direction, i.baseline,
         la.period, la.actual, t.value AS target,
         CASE
           WHEN la.actual IS NULL OR t.value IS NULL THEN NULL
           WHEN i.direction = 'increase' AND t.value <> COALESCE(i.baseline,0)
             THEN (la.actual - COALESCE(i.baseline,0)) / (t.value - COALESCE(i.baseline,0))
           WHEN i.direction = 'decrease' AND COALESCE(i.baseline,0) <> t.value
             THEN (COALESCE(i.baseline,0) - la.actual) / (COALESCE(i.baseline,0) - t.value)
           ELSE NULL
         END AS achievement
  FROM indicator i
  LEFT JOIN last_actual la ON la.tenant_id = i.tenant_id AND la.indicator_id = i.id
  LEFT JOIN indicator_value t ON t.tenant_id = i.tenant_id AND t.indicator_id = i.id
       AND t.kind = 'target' AND t.dimensions = '{}' AND t.period = la.period
)
SELECT c.*,
       c.actual - c.target AS gap,
       CASE
         WHEN c.achievement IS NULL THEN 'GREY'
         WHEN c.achievement >= COALESCE(sc.green_min, 0.90) THEN 'GREEN'
         WHEN c.achievement >= COALESCE(sc.amber_min, 0.60) THEN 'AMBER'
         ELSE 'RED'
       END AS status
FROM calc c
LEFT JOIN status_config sc ON sc.tenant_id = c.tenant_id;
GRANT SELECT ON v_indicator_progress TO ned_app;
