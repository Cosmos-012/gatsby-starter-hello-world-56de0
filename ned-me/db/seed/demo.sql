-- Projets de DÉMONSTRATION entièrement SYNTHÉTIQUES (aucune donnée réelle, aucun chiffre sourcé) : trois secteurs, trajectoires trimestrielles déterministes.
-- Appliqué après e2e.sql (même tenant). Les noms portent la mention « démo » ; ne jamais charger en production.
DO $$
DECLARE
  t constant uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  prog uuid; proj uuid; imp uuid; oc uuid; op uuid; ind uuid;
  p record; r record; q record;
BEGIN
  FOR p IN SELECT * FROM (VALUES
    ('EDU', 'Éducation de base', 'التعليم الأساسي', 'Basic education', 'Écoles rénovées et élèves accompagnés (démo synthétique)', 'Améliorer les acquis des élèves', 'Meilleurs résultats scolaires'),
    ('SAN', 'Santé de proximité', 'الصحة المجتمعية', 'Community health', 'Centres de santé et agents communautaires (démo synthétique)', 'Réduire la mortalité évitable', 'Accès aux soins primaires'),
    ('EAU', 'Eau et assainissement', 'المياه والصرف الصحي', 'Water and sanitation', 'Points d''eau et latrines (démo synthétique)', 'Réduire les maladies hydriques', 'Accès à l''eau potable')
  ) AS x(code, fr, ar, en, descr, impact_fr, outcome_fr) LOOP
    INSERT INTO program (tenant_id, code, name) VALUES (t, 'D-' || p.code, jsonb_build_object('fr', p.fr || ' (démo)', 'ar', p.ar, 'en', p.en || ' (demo)')) RETURNING id INTO prog;
    INSERT INTO project (tenant_id, program_id, code, name) VALUES (t, prog, p.code, jsonb_build_object('fr', p.fr || ' — démo', 'ar', p.ar, 'en', p.en || ' — demo')) RETURNING id INTO proj;
    INSERT INTO result (tenant_id, project_id, level, code, name) VALUES (t, proj, 'impact', p.code || '-I1', jsonb_build_object('fr', p.impact_fr)) RETURNING id INTO imp;
    INSERT INTO result (tenant_id, project_id, level, code, name, parent_id) VALUES (t, proj, 'outcome', p.code || '-O1', jsonb_build_object('fr', p.outcome_fr), imp) RETURNING id INTO oc;
    INSERT INTO result (tenant_id, project_id, level, code, name, parent_id) VALUES (t, proj, 'output', p.code || '-OP1', jsonb_build_object('fr', 'Services livrés'), oc) RETURNING id INTO op;

    -- 6 indicateurs par projet : (suffixe, libellé, unité, résultat, cible fin 2026, part réalisée visée au 3e trimestre 2026, direction)
    FOR r IN SELECT * FROM (VALUES
      ('1', 'Bénéficiaires directs', 'personnes', 'op', 12000, 0.92, 'increase'),
      ('2', 'Structures remises à niveau', 'structures', 'op', 60, 0.78, 'increase'),
      ('3', 'Agents formés', 'personnes', 'op', 400, 0.55, 'increase'),
      ('4', 'Taux de satisfaction des usagers', '%', 'oc', 85, 0.97, 'increase'),
      ('5', 'Délai moyen de traitement', 'jours', 'oc', 10, 1.35, 'decrease'),
      ('6', 'Couverture des zones prioritaires', '%', 'im', 70, 0.0, 'increase')
    ) AS y(sfx, lbl, unit, lvl, target, ratio, dir) LOOP
      INSERT INTO indicator (tenant_id, project_id, result_id, code, name, unit, direction, baseline, type)
      VALUES (t, proj, CASE r.lvl WHEN 'op' THEN op WHEN 'oc' THEN oc ELSE imp END, p.code || '-' || r.sfx,
              jsonb_build_object('fr', r.lbl), r.unit, r.dir, CASE r.dir WHEN 'decrease' THEN r.target * 2 ELSE 0 END,
              CASE WHEN r.unit = '%' THEN 'percentage' ELSE 'number' END)
      RETURNING id INTO ind;
      IF r.ratio = 0 THEN CONTINUE; END IF;   -- indicateur d'impact : volontairement sans donnée (jamais affiché à zéro)
      -- 7 trimestres (2025-Q1 → 2026-Q3) : cible linéaire, réalisé = cible × ratio, ralenti en début de projet
      FOR q IN SELECT g AS n, (2025 + (g - 1) / 4) || '-Q' || ((g - 1) % 4 + 1) AS lbl,
                      make_date(2025 + (g - 1) / 4, ((g - 1) % 4 + 1) * 3, 1) + interval '1 month - 1 day' AS pend
               FROM generate_series(1, 7) g LOOP
        INSERT INTO indicator_value (tenant_id, indicator_id, period, period_end, kind, value, workflow_state)
        SELECT t, ind, q.lbl, q.pend::date, 'target',
               CASE r.dir WHEN 'decrease' THEN r.target * 2 - (r.target * q.n / 8.0) ELSE round(r.target * q.n / 8.0, 1) END, 'approved';
        INSERT INTO indicator_value (tenant_id, indicator_id, period, period_end, kind, value, workflow_state)
        SELECT t, ind, q.lbl, q.pend::date, 'actual',
               CASE r.dir WHEN 'decrease' THEN round(r.target * 2 - (r.target * q.n / 8.0) * r.ratio * (0.85 + 0.03 * q.n), 1)
                          ELSE round(r.target * q.n / 8.0 * LEAST(r.ratio * (0.8 + 0.03 * q.n), 1.15), 1) END,
               CASE WHEN q.n = 7 THEN 'submitted' ELSE 'approved' END;
      END LOOP;
    END LOOP;

    INSERT INTO risk (tenant_id, project_id, code, title, probability, impact, owner_name, review_due) VALUES
      (t, proj, p.code || '-R1', 'Retard de décaissement', 3, 4, 'Direction financière', '2026-12-15'),
      (t, proj, p.code || '-R2', 'Rotation du personnel de terrain', 4, 3, 'Ressources humaines', '2026-11-30'),
      (t, proj, p.code || '-R3', 'Accès difficile en saison des pluies', 2, 3, 'Coordination terrain', '2027-01-31');
    INSERT INTO feedback (tenant_id, project_id, kind, channel, severity, subject, description, received_at, ack_due_at, due_at) VALUES
      (t, proj, 'complaint', 'hotline', 'medium', 'Information tardive aux bénéficiaires', 'Message de démonstration synthétique', '2026-09-20T09:00:00Z', '2026-09-22T09:00:00Z', '2026-10-04T09:00:00Z'),
      (t, proj, 'suggestion', 'box', 'low', 'Horaires d''ouverture', 'Message de démonstration synthétique', '2026-10-02T09:00:00Z', '2026-10-04T09:00:00Z', '2026-10-30T09:00:00Z');
  END LOOP;
END $$;
