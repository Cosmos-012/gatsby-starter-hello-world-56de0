\set ON_ERROR_STOP on
-- Données de deux tenants créées en superuser (hors RLS).
INSERT INTO tenant (id, name) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','A'), ('bbbbbbbb-0000-0000-0000-000000000002','B');
INSERT INTO program (tenant_id, code, name) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000001','P1','{"fr":"Prog A"}'),
 ('bbbbbbbb-0000-0000-0000-000000000002','P1','{"fr":"Prog B"}');
INSERT INTO project (tenant_id, program_id, code, name)
 SELECT tenant_id, id, 'PRJ', '{"fr":"Projet"}' FROM program;

-- Rôle de test se connectant comme l'API : non-superuser.
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ned_api') THEN
  CREATE ROLE ned_api LOGIN IN ROLE ned_app; END IF; END $$;
SET ROLE ned_api;

-- 1. Sans tenant : aucune ligne (fail closed).
DO $$ BEGIN
  IF (SELECT count(*) FROM project) <> 0 THEN RAISE EXCEPTION 'FAIL: fuite sans tenant'; END IF;
END $$;

BEGIN;
SET LOCAL app.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001';
SET LOCAL app.user_id = 'alice';
DO $$ BEGIN
  IF (SELECT count(*) FROM project) <> 1 THEN RAISE EXCEPTION 'FAIL: tenant A doit voir 1 projet'; END IF;
  IF (SELECT count(*) FROM tenant) <> 1 THEN RAISE EXCEPTION 'FAIL: tenant visible'; END IF;
END $$;

-- 2. Écriture cross-tenant refusée.
DO $$ BEGIN
  BEGIN
    INSERT INTO program (tenant_id, code, name) VALUES ('bbbbbbbb-0000-0000-0000-000000000002','X','{}');
    RAISE EXCEPTION 'FAIL: insertion cross-tenant acceptée';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- 3. Cadre de résultats + hiérarchie.
INSERT INTO result (tenant_id, project_id, level, code, name)
 SELECT tenant_id, id, 'impact', 'IMP1', '{"fr":"Impact"}' FROM project;
INSERT INTO result (tenant_id, project_id, parent_id, level, code, name)
 SELECT p.tenant_id, p.id, r.id, 'outcome', 'OC1', '{"fr":"Outcome"}' FROM project p JOIN result r ON r.project_id = p.id;
DO $$ BEGIN
  BEGIN
    INSERT INTO result (tenant_id, project_id, parent_id, level, code, name)
    SELECT p.tenant_id, p.id, r.id, 'impact', 'BAD', '{}' FROM project p JOIN result r ON r.code='OC1';
    RAISE EXCEPTION 'FAIL: impact sous outcome accepté';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- 4. Indicateur : baseline 0, cible 100, actual 95 => VERT ; 70 => AMBRE ; 30 => ROUGE ; sans actual => GRIS.
INSERT INTO indicator (tenant_id, project_id, code, name, baseline)
 SELECT tenant_id, id, 'IND1', '{"fr":"Ind"}', 0 FROM project;
INSERT INTO indicator (tenant_id, project_id, code, name, baseline)
 SELECT tenant_id, id, 'IND2', '{"fr":"Sans donnée"}', 0 FROM project;
INSERT INTO indicator_value (tenant_id, indicator_id, period, period_end, kind, value, workflow_state)
 SELECT tenant_id, id, '2026-Q1', '2026-03-31', 'target', 100, 'approved' FROM indicator WHERE code='IND1';
INSERT INTO indicator_value (tenant_id, indicator_id, period, period_end, kind, value, workflow_state)
 SELECT tenant_id, id, '2026-Q1', '2026-03-31', 'actual', 95, 'validated' FROM indicator WHERE code='IND1';
DO $$ BEGIN
  IF (SELECT status FROM v_indicator_progress WHERE code='IND1') <> 'GREEN' THEN RAISE EXCEPTION 'FAIL: attendu GREEN'; END IF;
  IF (SELECT status FROM v_indicator_progress WHERE code='IND2') <> 'GREY' THEN RAISE EXCEPTION 'FAIL: attendu GREY'; END IF;
  IF (SELECT gap FROM v_indicator_progress WHERE code='IND1') <> -5 THEN RAISE EXCEPTION 'FAIL: gap'; END IF;
END $$;
-- Un actual non validé ne compte pas.
INSERT INTO indicator_value (tenant_id, indicator_id, period, period_end, kind, value, workflow_state)
 SELECT tenant_id, id, '2026-Q2', '2026-06-30', 'actual', 10, 'draft' FROM indicator WHERE code='IND1';
DO $$ BEGIN
  IF (SELECT actual FROM v_indicator_progress WHERE code='IND1') <> 95 THEN RAISE EXCEPTION 'FAIL: draft pris en compte'; END IF;
END $$;
UPDATE indicator_value SET value = 70 WHERE kind='actual' AND period='2026-Q1';
DO $$ BEGIN
  IF (SELECT status FROM v_indicator_progress WHERE code='IND1') <> 'AMBER' THEN RAISE EXCEPTION 'FAIL: attendu AMBER'; END IF;
END $$;
UPDATE indicator_value SET value = 30 WHERE kind='actual' AND period='2026-Q1';
DO $$ BEGIN
  IF (SELECT status FROM v_indicator_progress WHERE code='IND1') <> 'RED' THEN RAISE EXCEPTION 'FAIL: attendu RED'; END IF;
END $$;

-- 5. Audit : l'UPDATE est tracé avec l'acteur ; ned_app ne peut pas altérer le journal.
DO $$ BEGIN
  IF (SELECT count(*) FROM audit_log WHERE table_name='indicator_value' AND op='UPDATE' AND actor='alice') < 2
  THEN RAISE EXCEPTION 'FAIL: audit manquant'; END IF;
  BEGIN DELETE FROM audit_log; RAISE EXCEPTION 'FAIL: audit modifiable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
COMMIT;

-- 6. Tenant B ne voit rien de A.
BEGIN;
SET LOCAL app.tenant_id = 'bbbbbbbb-0000-0000-0000-000000000002';
DO $$ BEGIN
  IF (SELECT count(*) FROM indicator) <> 0 OR (SELECT count(*) FROM audit_log WHERE actor = 'alice' OR table_name IN ('indicator','indicator_value')) <> 0 THEN RAISE EXCEPTION 'FAIL: fuite vers B'; END IF;
END $$;
COMMIT;
