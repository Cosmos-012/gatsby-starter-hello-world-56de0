import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import pg from 'pg';
import { allMigrations } from './migrations.ts';
import { makePool, withTenant } from '../src/db.ts';
import { makeVerifier } from '../src/auth.ts';
import { buildApp } from '../src/app.ts';
import { riskSummary } from '../src/risks.ts';

const ADMIN = process.env.ADMIN_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const DB = 'ned_risk_test', SECRET = 'test-secret-test-secret-test-secret';
const T1 = 'aaaaaaaa-0000-0000-0000-000000000001', T2 = 'bbbbbbbb-0000-0000-0000-000000000002';
let pool: pg.Pool, app: ReturnType<typeof buildApp>, projectId = '', resultId = '', indicatorId = '';
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
  for (const sql of allMigrations()) await owner.query(sql);
  await owner.query(`DROP ROLE IF EXISTS ned_risk_login; CREATE ROLE ned_risk_login LOGIN PASSWORD 'x' IN ROLE ned_app`);
  await owner.query(`INSERT INTO tenant (id,name) VALUES ('${T1}','A'),('${T2}','B')`);
  await owner.end();
  pool = makePool(ADMIN.replace(/\/\/[^@]*@/, '//ned_risk_login:x@').replace(/\/[^/]*$/, `/${DB}`));
  app = buildApp(pool, makeVerifier({ secret: SECRET }));
  await withTenant(pool, SEED, async (c) => {
    const prog = (await c.query("INSERT INTO program (tenant_id,code,name) VALUES (app.current_tenant(),'P','{\"fr\":\"p\"}') RETURNING id")).rows[0].id;
    projectId = (await c.query("INSERT INTO project (tenant_id,program_id,code,name) VALUES (app.current_tenant(),$1,'J','{\"fr\":\"j\"}') RETURNING id", [prog])).rows[0].id;
    resultId = (await c.query("INSERT INTO result (tenant_id,project_id,level,code,name) VALUES (app.current_tenant(),$1,'output','OP1','{\"fr\":\"r\"}') RETURNING id", [projectId])).rows[0].id;
    indicatorId = (await c.query("INSERT INTO indicator (tenant_id,project_id,result_id,code,name) VALUES (app.current_tenant(),$1,$2,'IND1','{\"fr\":\"i\"}') RETURNING id", [projectId, resultId])).rows[0].id;
  });
});
after(async () => { await app.close(); await pool.end(); });

const mk = (t: string, body: object) => call('POST', '/risks', t, { project_id: projectId, owner_name: 'Directeur de projet', category: 'technical', ...body });
let critical = '', medium = '';

test('création : validations, score/niveau calculés, liens, doublon, isolation des références', async () => {
  const entry = await tok('dana', T1, ['data_entry']), viewer = await tok('v', T1, ['viewer']);
  assert.equal((await mk(viewer, { code: 'R0', title: 'Retard fournisseur', probability: 3, impact: 3 })).status, 403);
  assert.equal((await mk(entry, { code: 'R0', title: 'Retard fournisseur', probability: 6, impact: 3 })).status, 400);
  const c = await mk(entry, { code: 'R1', title: 'Cyberattaque sur la plateforme', probability: 4, impact: 5, review_due: '2026-10-01', result_ids: [resultId], indicator_ids: [indicatorId] });
  assert.equal(c.status, 201); assert.equal(c.body.score, 20); assert.equal(c.body.level, 'critical'); critical = c.body.id;
  const m = await mk(entry, { code: 'R2', title: 'Retards de passation', probability: 3, impact: 2 });
  assert.equal(m.body.score, 6); assert.equal(m.body.level, 'medium'); medium = m.body.id;
  assert.equal((await mk(entry, { code: 'R3', title: 'Risque faible', probability: 1, impact: 4 })).body.level, 'low');
  assert.equal((await mk(entry, { code: 'R4', title: 'Risque élevé', probability: 2, impact: 5 })).body.level, 'high');       // 10 = seuil « high »
  assert.equal((await mk(entry, { code: 'R1', title: 'Doublon de code', probability: 1, impact: 1 })).status, 409);
  const other = await tok('o', T2, ['me_manager']);
  assert.equal((await call('POST', '/risks', other, { project_id: projectId, code: 'X', title: 'Autre tenant', owner_name: 'Moi', probability: 1, impact: 1 })).status, 422);
});

test('liste : filtres par niveau, résultat, indicateur ; drapeaux d\'escalade et de revue', async () => {
  const viewer = await tok('v', T1, ['viewer']);
  const all = (await call('GET', `/risks?project_id=${projectId}&as_of=${ASOF}`, viewer)).body;
  assert.deepEqual(all.map((r: any) => r.code), ['R1', 'R4', 'R2', 'R3']);                 // tri par score décroissant
  const r1 = all.find((r: any) => r.code === 'R1');
  assert.equal(r1.needs_escalation, true); assert.equal(r1.review_overdue, true);
  assert.equal(all.find((r: any) => r.code === 'R2').review_overdue, false);                // pas d'échéance de revue : faux, jamais null
  assert.deepEqual((await call('GET', `/risks?level=critical`, viewer)).body.map((r: any) => r.code), ['R1']);
  assert.deepEqual((await call('GET', `/risks?result_id=${resultId}`, viewer)).body.map((r: any) => r.code), ['R1']);
  assert.deepEqual((await call('GET', `/risks?indicator_id=${indicatorId}`, viewer)).body.map((r: any) => r.code), ['R1']);
  const d = (await call('GET', `/risks/${critical}`, viewer)).body;
  assert.equal(d.results[0].code, 'OP1'); assert.equal(d.indicators[0].code, 'IND1'); assert.equal(d.assessments.length, 1);
});

test('règles : atténuation avant « mitigating », acceptation d\'un risque critique, clôture', async () => {
  const mgr = await tok('mgr', T1, ['me_manager']), rev = await tok('rick', T1, ['reviewer']), entry = await tok('dana', T1, ['data_entry']);
  const tr = (id: string, body: object) => call('POST', `/risks/${id}/transition`, mgr, body);
  assert.equal((await call('POST', `/risks/${critical}/transition`, rev, { to: 'mitigating' })).status, 403);             // transition = manager
  assert.equal((await tr(critical, { to: 'mitigating' })).status, 409);                                                    // aucune action d'atténuation
  assert.equal((await call('POST', `/risks/${critical}/mitigations`, entry, { description: 'Audit de sécurité', responsible_name: 'RSSI', due_date: '2026-11-01' })).status, 403);
  const mit = await call('POST', `/risks/${critical}/mitigations`, rev, { description: 'Audit de sécurité externe', responsible_name: 'RSSI', responsible_user: 'sam', due_date: '2026-11-01' });
  assert.equal(mit.status, 201);
  assert.equal((await tr(critical, { to: 'mitigating' })).status, 200);
  assert.equal((await tr(critical, { to: 'accepted', rationale: 'Coût de mitigation supérieur à l\'impact' })).status, 409);   // critique non escaladé
  assert.equal((await call('POST', `/risks/${critical}/escalate`, rev, { to: 'Comité de pilotage' })).status, 403);
  assert.equal((await call('POST', `/risks/${critical}/escalate`, mgr, { to: 'Comité de pilotage' })).body.escalation_level, 1);
  assert.equal((await tr(critical, { to: 'accepted' })).status, 409);                                                      // motif obligatoire
  assert.equal((await tr(critical, { to: 'closed', note: 'Traité' })).status, 409);                                        // action ouverte
  const sam = await tok('sam', T1, ['data_entry']);
  assert.equal((await call('POST', `/risk-mitigations/${mit.body.id}/complete`, entry, { note: 'fait' })).status, 403);   // pas le responsable
  assert.equal((await call('POST', `/risk-mitigations/${mit.body.id}/complete`, sam, { note: 'ok' })).status, 400);        // note trop courte
  assert.equal((await call('POST', `/risk-mitigations/${mit.body.id}/complete`, sam, { status: 'cancelled', note: 'abandon' })).status, 403);
  assert.equal((await call('POST', `/risk-mitigations/${mit.body.id}/complete`, sam, { note: 'Audit réalisé et rapport reçu' })).status, 200);
  assert.equal((await call('POST', `/risk-mitigations/${mit.body.id}/complete`, sam, { note: 'deuxième fois' })).status, 409);
  assert.equal((await tr(critical, { to: 'closed' })).status, 409);                                                        // note de clôture obligatoire
  assert.equal((await tr(critical, { to: 'accepted', rationale: 'Risque résiduel jugé tolérable par le comité' })).status, 200);
  assert.equal((await tr(critical, { to: 'closed', note: 'Risque résiduel accepté et suivi' })).body.status, 'closed');
  assert.equal((await tr(critical, { to: 'open' })).status, 409);                                                          // clos : figé
  assert.equal((await call('POST', `/risks/${critical}/assess`, mgr, { probability: 1, impact: 1 })).status, 409);
  assert.equal((await call('POST', `/risks/${critical}/mitigations`, mgr, { description: 'Trop tard', responsible_name: 'X Y', due_date: '2027-01-01' })).status, 409);
  assert.equal((await call('POST', `/risks/${critical}/escalate`, mgr, { to: 'Direction générale' })).status, 404);          // clos : pas d'escalade
});

test('réévaluation : historique probabilité × impact avec note ; escalade plafonnée à 3 ; transitions invalides', async () => {
  const mgr = await tok('mgr', T1, ['me_manager']), rev = await tok('rick', T1, ['reviewer']);
  const a = await call('POST', `/risks/${medium}/assess`, rev, { probability: 4, impact: 4, note: 'Retards confirmés par le marché' });
  assert.equal(a.body.score, 16); assert.equal(a.body.level, 'critical');                                                   // le niveau suit
  await call('POST', `/risks/${medium}/assess`, rev, { probability: 4, impact: 4 });                                        // inchangé : pas de nouvelle ligne
  const h = (await call('GET', `/risks/${medium}`, mgr)).body.assessments;
  assert.deepEqual(h.map((x: any) => x.score), [6, 16]);
  assert.equal(h[1].note, 'Retards confirmés par le marché'); assert.equal(h[1].actor, 'rick'); assert.equal(h[0].note, null);
  for (const to of ['Chef de projet', 'Directeur', 'Comité']) assert.equal((await call('POST', `/risks/${medium}/escalate`, mgr, { to })).status, 200);
  assert.equal((await call('POST', `/risks/${medium}/escalate`, mgr, { to: 'Ministre' })).status, 409);                      // niveau 3 maximum
  assert.equal((await call('POST', `/risks/${medium}/transition`, mgr, { to: 'closed', note: 'ok' })).status, 409);           // note ≥ 5 caractères
  assert.equal((await call('POST', `/risks/${medium}/transition`, mgr, { to: 'materialized' })).status, 200);
  assert.equal((await call('POST', `/risks/${medium}/transition`, mgr, { to: 'open' })).status, 409);                         // matérialisé → seulement clos
});

test('problèmes : lien avec un risque (matérialisation), résolution motivée, clôture manager, figé', async () => {
  const mgr = await tok('mgr', T1, ['me_manager']), entry = await tok('dana', T1, ['data_entry']), pat = await tok('pat', T1, ['data_entry']);
  const risk = (await mk(entry, { code: 'R5', title: 'Rupture de licence logicielle', probability: 2, impact: 2 })).body.id;
  const i = await call('POST', '/issues', entry, { project_id: projectId, risk_id: risk, title: 'Licence expirée, plateforme indisponible', severity: 'critical', owner_name: 'Patrice', owner_user: 'pat', due_date: '2026-11-15' });
  assert.equal(i.status, 201);
  assert.equal((await call('GET', `/risks/${risk}`, mgr)).body.status, 'materialized');
  const id = i.body.id, tr = (t: string, body: object) => call('POST', `/issues/${id}/transition`, t, body);
  assert.equal((await tr(entry, { to: 'in_progress' })).status, 403);                    // ni propriétaire ni manager
  assert.equal((await tr(pat, { to: 'escalated' })).status, 400);                        // destinataire requis
  assert.equal((await tr(pat, { to: 'escalated', escalated_to: 'DSI' })).status, 200);
  assert.equal((await tr(pat, { to: 'resolved' })).status, 409);                         // résolution obligatoire (base)
  assert.equal((await tr(pat, { to: 'resolved', resolution: 'Licence renouvelée le 20/11' })).status, 200);
  assert.equal((await tr(pat, { to: 'closed' })).status, 403);                           // clôture = manager
  assert.equal((await tr(mgr, { to: 'closed' })).status, 200);
  assert.equal((await tr(mgr, { to: 'in_progress' })).status, 409);                      // clos : figé
  assert.equal((await call('POST', '/issues', entry, { project_id: projectId, risk_id: critical, title: 'Sur un risque clos', owner_name: 'Moi Même', due_date: '2026-12-01' })).status, 409);   // risque clos
  const late = await call('POST', '/issues', entry, { project_id: projectId, title: 'Retard de livraison du matériel', severity: 'high', owner_name: 'Logistique', due_date: '2026-10-15' });
  const list = (await call('GET', `/issues?project_id=${projectId}&as_of=${ASOF}`, mgr)).body;
  assert.deepEqual(list.map((x: any) => [x.severity, x.status, x.overdue]), [['high', 'open', true], ['critical', 'closed', false]]);
  assert.equal((await call('GET', `/issues?severity=critical&status=closed`, mgr)).body.length, 1);
  assert.ok(late.body.id);
});

test('synthèse et isolation tenant', async () => {
  const s = await withTenant(pool, { sub: 'x', tenantId: T1, roles: ['viewer'] }, (c) => riskSummary(c, projectId, ASOF));
  // vivants : R4 (high, 10) ; R3 (low) ; R1 clos, R2 matérialisé, R5 matérialisé
  assert.deepEqual(s.open_by_level, { critical: 0, high: 1, medium: 0, low: 1 }); assert.equal(s.open_total, 2);
  assert.equal(s.critical_unescalated, 0); assert.equal(s.review_overdue, 0);
  assert.deepEqual(s.open_issues_by_severity, { critical: 0, high: 1, medium: 0, low: 0 }); assert.equal(s.open_issues_total, 1); assert.equal(s.overdue_issues, 1);
  assert.equal(s.overdue_mitigations, 0);
  const other = await tok('o', T2, ['me_manager']);
  assert.deepEqual((await call('GET', '/risks', other)).body, []); assert.deepEqual((await call('GET', '/issues', other)).body, []);
  assert.equal((await call('GET', `/risks/${medium}`, other)).status, 404);
  assert.equal((await call('POST', `/risks/${medium}/escalate`, other, { to: 'Pirate' })).status, 404);
  const z = await withTenant(pool, { sub: 'x', tenantId: T2, roles: ['viewer'] }, (c) => riskSummary(c, undefined, ASOF));
  assert.equal(z.open_total, 0); assert.equal(z.open_issues_total, 0);
});
