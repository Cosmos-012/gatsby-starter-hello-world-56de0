import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import pg from 'pg';
import { makePool, withTenant } from '../src/db.ts';
import { makeVerifier } from '../src/auth.ts';
import { buildApp } from '../src/app.ts';
import { buildAlerts } from '../src/dashboard.ts';

const ADMIN = process.env.ADMIN_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const DB = 'ned_dsh_test', SECRET = 'test-secret-test-secret-test-secret';
const T1 = 'aaaaaaaa-0000-0000-0000-000000000001', T2 = 'bbbbbbbb-0000-0000-0000-000000000002';
const dir = new URL('../../db/migrations/', import.meta.url);
let pool: pg.Pool, app: ReturnType<typeof buildApp>, projectId = '', otherProject = '';
const SEED = { sub: 'seed', tenantId: T1, roles: [] as string[] };
const ASOF = '2026-12-01';

const tok = (sub: string, tenant: string, roles: string[]) => new SignJWT({ tenant_id: tenant, roles }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
const call = async (method: string, url: string, token: string, payload?: unknown) => {
  const r = await app.inject({ method: method as 'GET', url, payload: payload as object, headers: { authorization: `Bearer ${token}` } });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
};

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN }); await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB}`); await admin.query(`CREATE DATABASE ${DB}`); await admin.end();
  const owner = new pg.Client({ connectionString: ADMIN.replace(/\/[^/]*$/, `/${DB}`) }); await owner.connect();
  for (const f of ['001_foundation', '002_results_indicators', '004_arabic_search', '005_workflow', '006_dqa', '007_evidence', '008_evaluations', '009_meal', '010_reports', '011_risks']) await owner.query(readFileSync(new URL(`${f}.sql`, dir), 'utf8'));
  await owner.query(`DROP ROLE IF EXISTS ned_dsh_login; CREATE ROLE ned_dsh_login LOGIN PASSWORD 'x' IN ROLE ned_app`);
  await owner.query(`INSERT INTO tenant (id,name) VALUES ('${T1}','A'),('${T2}','B')`);
  await owner.end();
  pool = makePool(ADMIN.replace(/\/\/[^@]*@/, '//ned_dsh_login:x@').replace(/\/[^/]*$/, `/${DB}`));
  app = buildApp(pool, makeVerifier({ secret: SECRET }));
  await withTenant(pool, SEED, async (c) => {
    const prog = (await c.query("INSERT INTO program (tenant_id,code,name) VALUES (app.current_tenant(),'P','{\"fr\":\"p\"}') RETURNING id")).rows[0].id;
    const proj = async (code: string) => (await c.query("INSERT INTO project (tenant_id,program_id,code,name) VALUES (app.current_tenant(),$1,$2,'{\"fr\":\"j\"}') RETURNING id", [prog, code])).rows[0].id;
    projectId = await proj('J'); otherProject = await proj('K');
    const res = async (level: string, code: string, parent: string | null) => (await c.query(
      "INSERT INTO result (tenant_id,project_id,level,code,name,parent_id) VALUES (app.current_tenant(),$1,$2,$3,'{\"fr\":\"r\"}',$4) RETURNING id", [projectId, level, code, parent])).rows[0].id;
    const imp = await res('impact', 'I1', null), oc = await res('outcome', 'O1', imp), op = await res('output', 'OP1', oc);
    const ind = async (code: string, result: string, project = projectId) => (await c.query(
      "INSERT INTO indicator (tenant_id,project_id,result_id,code,name,baseline) VALUES (app.current_tenant(),$1,$2,$3,'{\"fr\":\"i\"}',0) RETURNING id", [project, result, code])).rows[0].id;
    const val = (id: string, k: string, v: number) => c.query(
      "INSERT INTO indicator_value (tenant_id,indicator_id,period,period_end,kind,value,workflow_state) VALUES (app.current_tenant(),$1,'Q1','2026-03-31',$2,$3,'approved')", [id, k, v]);
    for (const [code, result, actual] of [['A', op, 95], ['B', op, 50], ['C', oc, 70]] as const) { const id = await ind(code, result); await val(id, 'target', 100); await val(id, 'actual', actual); }
    await ind('D', imp);                                           // aucune donnée
    // Autre projet : ne doit pas contaminer la vue filtrée
    const other = await ind('Z', op, otherProject); await val(other, 'target', 10); await val(other, 'actual', 1);
  });
});
after(async () => { await app.close(); await pool.end(); });

test('buildAlerts : ordre, plafonds et clés (aucun texte codé en dur)', () => {
  const a = buildAlerts({ red: Array.from({ length: 8 }, (_, i) => ({ indicator_id: `i${i}`, code: `R${i}`, achievement: i / 10 })), atRisk: [], dqErrors: 0,
    overdueActions: [{ id: 'a1', recommendation_id: 'r1', days_late: 31 }, { id: 'a2', recommendation_id: 'r1', days_late: 5 }], overdueComplaints: 0, unackComplaints: 2, unansweredHigh: [] });
  assert.equal(a.filter((x) => x.type === 'red_indicator').length, 5);                      // plafonné
  assert.equal((a.find((x) => x.type === 'red_indicator')!.params as any).code, 'R0');       // pire d'abord
  assert.deepEqual(a.filter((x) => x.type === 'overdue_action').map((x) => x.severity), ['critical', 'warning']);
  assert.ok(!a.some((x) => x.type === 'dq_errors' || x.type === 'overdue_complaints'));     // rien si zéro
  assert.ok(a.every((x) => /^[a-z_]+$/.test(x.type)));
});

test('vue projet : performance, statuts, niveaux ; l\'autre projet est exclu ; modules absents déclarés', async () => {
  const viewer = await tok('v', T1, ['viewer']);
  const r = await call('GET', `/dashboard/overview?project_id=${projectId}&as_of=${ASOF}`, viewer);
  assert.equal(r.status, 200);
  const p = r.body.performance;
  assert.deepEqual(p.by_status, { GREEN: 1, AMBER: 1, RED: 1, GREY: 1 });
  assert.equal(p.indicators_total, 4); assert.equal(p.with_data, 3); assert.equal(p.coverage, 0.75);
  assert.equal(p.overall, 0.7167);                                    // (0.95 + 0.5 + 0.7) / 3
  assert.deepEqual(p.by_result_level, [
    { level: 'impact', indicators: 1, with_data: 0, avg_achievement: null },    // pas de zéro inventé
    { level: 'outcome', indicators: 1, with_data: 1, avg_achievement: 0.7 },
    { level: 'output', indicators: 2, with_data: 2, avg_achievement: 0.725 }]);
  assert.deepEqual(r.body.not_available, ['activities', 'finance', 'procurement']);
  assert.equal(r.body.risks.open_total, 0); assert.equal(r.body.risks.open_issues_total, 0);   // module présent : zéros réels, plus « non disponible »
  assert.ok(p.source.startsWith('/indicators/tracking?project_id=' + projectId));
  const global = (await call('GET', `/dashboard/overview?as_of=${ASOF}`, viewer)).body;
  assert.equal(global.performance.indicators_total, 5);               // sans filtre : les deux projets
  assert.ok(!global.performance.source.includes('project_id'));
});

test('agrégats cohérents avec les endpoints sources (DQA, évaluations, MEAL, apprentissage) et alertes', async () => {
  const mgr = await tok('mgr', T1, ['me_manager']), rev = await tok('rick', T1, ['reviewer']), entry = await tok('dana', T1, ['data_entry']);
  await call('POST', '/dqa/run', rev, { project_id: projectId, as_of: ASOF });
  // évaluation avec une recommandation en retard et une sans réponse (haute priorité)
  const ev = (await call('POST', '/evaluations', mgr, { project_id: projectId, title: 'Évaluation à mi-parcours', type: 'midterm' })).body.id;
  await call('POST', `/evaluations/${ev}/status`, mgr, { to: 'ongoing' });
  const r1 = (await call('POST', `/evaluations/${ev}/recommendations`, mgr, { text: 'Renforcer le suivi' })).body.id;
  await call('POST', `/evaluations/${ev}/recommendations`, mgr, { text: 'Clarifier les rôles', priority: 'high' });
  await call('POST', `/recommendations/${r1}/response`, mgr, { type: 'accepted', text: 'Acceptée, mise en œuvre prévue' });
  await call('POST', `/recommendations/${r1}/actions`, mgr, { description: 'Tableau de bord de suivi', responsible_name: 'M&E', due_date: '2026-10-01' });
  // MEAL : une plainte en retard, une satisfaction, deux leçons brouillon
  const base = { project_id: projectId, channel: 'hotline', subject: 'Retard de paiement', description: 'Attente de deux mois' };
  await call('POST', '/feedback', entry, { ...base, kind: 'complaint', severity: 'high', received_at: '2026-08-01T00:00:00Z' });
  await call('POST', '/feedback', entry, { ...base, kind: 'satisfaction', satisfaction_score: 4, subject: 'Atelier' });
  for (const t of ['Leçon une', 'Leçon deux']) await call('POST', '/lessons', entry, { project_id: projectId, category: 'lesson', title: t, description: 'Description suffisamment longue' });

  // Risques : un risque critique non escaladé, revue échue le 01/10, action d'atténuation échue ; un problème critique ouvert et échu
  const risk = (await call('POST', '/risks', entry, { project_id: projectId, code: 'R1', title: 'Cyberattaque', probability: 4, impact: 5, owner_name: 'DSI', review_due: '2026-10-01' })).body.id;
  await call('POST', `/risks/${risk}/mitigations`, mgr, { description: 'Audit de sécurité', responsible_name: 'RSSI', due_date: '2026-11-01' });
  await call('POST', '/issues', entry, { project_id: projectId, title: 'Plateforme indisponible', severity: 'critical', owner_name: 'DSI', due_date: '2026-11-01' });
  const d = (await call('GET', `/dashboard/overview?project_id=${projectId}&as_of=${ASOF}`, rev)).body;
  const scores = (await call('GET', `/dqa/scores?project_id=${projectId}&as_of=${ASOF}`, rev)).body;
  assert.equal(d.data_quality.indicators_assessed, 4);
  assert.equal(d.data_quality.average_score, Math.round(scores.reduce((s: number, x: any) => s + x.score, 0) / scores.length * 10) / 10);   // cohérent avec la source
  assert.deepEqual(d.data_quality.open_issues, { error: 6, warning: 8 });     // 3 indicateurs × 2 périodes échues ; 4 × (sans source + non vérifié)
  assert.deepEqual(d.evaluations.by_status, { ongoing: 1 });
  assert.deepEqual(d.evaluations.recommendations, { total: 2, closure_rate: 0, unanswered: 1, overdue_actions: 1 });
  assert.deepEqual(d.accountability, { open_feedback: 1, overdue_resolution: 1, overdue_acknowledgement: 1, satisfaction_avg: 4, source: d.accountability.source });
  assert.deepEqual(d.learning, { total: 2, by_status: { draft: 2 }, source: d.learning.source });

  const { source: _s, ...rk } = d.risks;
  assert.deepEqual(rk, { open_by_level: { critical: 1, high: 0, medium: 0, low: 0 }, open_total: 1, critical_unescalated: 1, review_overdue: 1, overdue_mitigations: 1,
    open_issues_by_severity: { critical: 1, high: 0, medium: 0, low: 0 }, open_issues_total: 1, overdue_issues: 1 });
  const types = d.alerts.map((a: any) => `${a.severity}:${a.type}`);
  assert.deepEqual(types, ['critical:dq_errors', 'critical:overdue_action', 'critical:overdue_complaints', 'critical:critical_risk_unescalated', 'critical:open_critical_issues',
    'warning:complaints_unacknowledged', 'warning:overdue_issues', 'warning:overdue_mitigations', 'warning:risk_review_overdue', 'warning:red_indicator', 'warning:unanswered_recommendation']);
  assert.equal(d.alerts.find((a: any) => a.type === 'overdue_action').params.days_late, 61);
  assert.equal(d.alerts.find((a: any) => a.type === 'red_indicator').params.code, 'B');
  assert.equal(d.alerts.find((a: any) => a.type === 'dq_errors').params.count, 6);
});

test('droits, validation et isolation tenant', async () => {
  const other = await tok('o', T2, ['me_manager']);
  assert.equal((await call('GET', '/dashboard/overview', await tok('x', T1, []))).status, 403);
  assert.equal((await call('GET', '/dashboard/overview?project_id=nope', other)).status, 400);
  assert.equal((await call('GET', '/dashboard/overview?as_of=bad', other)).status, 400);
  const d = (await call('GET', `/dashboard/overview?project_id=${projectId}&as_of=${ASOF}`, other)).body;
  assert.equal(d.performance.indicators_total, 0); assert.equal(d.performance.overall, null); assert.equal(d.data_quality.average_score, null);
  assert.deepEqual(d.alerts, []);
});
