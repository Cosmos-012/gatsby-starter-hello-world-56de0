-- Jeu de données déterministe pour les tests de bout en bout de l'interface (valeurs attendues calculables à la main).
-- Appliqué en superuser après les migrations. Tenant A ; à la date du 2026-12-01 :
--   A (output)  95/100 → VERT ; B (output) 50/100 → ROUGE ; C (outcome) 70/100 → AMBRE ; D (impact) sans donnée → GRIS
--   performance globale = (0.95 + 0.5 + 0.7) / 3 = 0.7167 ; couverture = 3/4 ; output = 0.725 ; outcome = 0.7 ; impact = aucune donnée
--   1 risque critique non escaladé ; 1 plainte haute reçue le 2026-08-01 (hors délai de résolution et d'accusé)
INSERT INTO tenant (id, name) VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'Démo');
INSERT INTO program (id, tenant_id, code, name) VALUES
  ('10000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'TN',
   '{"fr":"Transformation numérique","ar":"التحول الرقمي","en":"Digital transformation"}');
INSERT INTO project (id, tenant_id, program_id, code, name) VALUES
  ('20000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'SNN',
   '{"fr":"Services numériques nationaux","ar":"الخدمات الرقمية الوطنية","en":"National digital services"}');
INSERT INTO result (id, tenant_id, project_id, level, code, name, parent_id) VALUES
  ('30000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'impact',  'I1',  '{"fr":"Services publics améliorés"}', NULL),
  ('30000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'outcome', 'O1',  '{"fr":"Accès accru"}', '30000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'output',  'OP1', '{"fr":"Portail déployé"}', '30000000-0000-0000-0000-000000000002');
INSERT INTO indicator (id, tenant_id, project_id, result_id, code, name, baseline) VALUES
  ('40000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'A', '{"fr":"Services en ligne"}', 0),
  ('40000000-0000-0000-0000-00000000000b', 'aaaaaaaa-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'B', '{"fr":"Agents formés"}', 0),
  ('40000000-0000-0000-0000-00000000000c', 'aaaaaaaa-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'C', '{"fr":"Usagers actifs"}', 0),
  ('40000000-0000-0000-0000-00000000000d', 'aaaaaaaa-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'D', '{"fr":"Satisfaction nationale"}', 0);
INSERT INTO indicator_value (tenant_id, indicator_id, period, period_end, kind, value, workflow_state)
SELECT 'aaaaaaaa-0000-0000-0000-000000000001', i, 'Q1', '2026-03-31', k, v, 'approved'
FROM (VALUES ('40000000-0000-0000-0000-00000000000a'::uuid, 'target', 100), ('40000000-0000-0000-0000-00000000000a'::uuid, 'actual', 95),
             ('40000000-0000-0000-0000-00000000000b'::uuid, 'target', 100), ('40000000-0000-0000-0000-00000000000b'::uuid, 'actual', 50),
             ('40000000-0000-0000-0000-00000000000c'::uuid, 'target', 100), ('40000000-0000-0000-0000-00000000000c'::uuid, 'actual', 70)) AS x(i, k, v);
INSERT INTO risk (tenant_id, project_id, code, title, probability, impact, owner_name, review_due) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'R1', 'Cyberattaque', 4, 5, 'DSI', '2026-10-01');
INSERT INTO feedback (tenant_id, project_id, kind, channel, severity, subject, description, received_at, ack_due_at, due_at) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'complaint', 'hotline', 'high', 'Retard de paiement',
   'Attente de deux mois', '2026-08-01T00:00:00Z', '2026-08-03T00:00:00Z', '2026-08-08T00:00:00Z');
