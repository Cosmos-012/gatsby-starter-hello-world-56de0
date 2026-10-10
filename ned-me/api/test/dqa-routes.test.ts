import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import pg from 'pg';
import { allMigrations } from './migrations.ts';
import { makePool, withTenant } from '../src/db.ts';
import { makeVerifier } from '../src/auth.ts';
import { buildApp } from '../src/app.ts';

const ADMIN = process.env.ADMIN_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const DB = 'ned_dqa_test', SECRET = 'test-secret-test-secret-test-secret';
const T1 = 'aaaaaaaa-0000-0000-0000-000000000001', T2 = 'bbbbbbbb-0000-0000-0000-000000000002';
let pool: pg.Pool, app: ReturnType<typeof buildApp>, projectId: string, indId: string, cleanId: string;
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
  await owner.query(`DROP ROLE IF EXISTS ned_dqa_login; CREATE ROLE ned_dqa_login LOGIN PASSWORD 'x' IN ROLE ned_app`);
  await owner.query(`INSERT INTO tenant (id,name) VALUES ('${T1}','A'),('${T2}','B')`);
  await owner.end();
  pool = makePool(ADMIN.replace(/\/\/[^@]*@/, '//ned_dqa_login:x@').replace(/\/[^/]*$/, `/${DB}`));
  app = buildApp(pool, makeVerifier({ secret: SECRET }));
  await withTenant(pool, SEED, async (c) => {
    const prog = (await c.query("INSERT INTO program (tenant_id,code,name) VALUES (app.current_tenant(),'P','{\"fr\":\"p\"}') RETURNING id")).rows[0].id;
    projectId = (await c.query("INSERT INTO project (tenant_id,program_id,code,name) VALUES (app.current_tenant(),$1,'J','{\"fr\":\"j\"}') RETURNING id", [prog])).rows[0].id;
    const ind = async (code: string, src: string | null, ver: string) => (await c.query(
      "INSERT INTO indicator (tenant_id,project_id,code,name,baseline,data_source,verification_status) VALUES (app.current_tenant(),$1,$2,'{\"fr\":\"x\"}',0,$3,$4) RETURNING id", [projectId, code, src, ver])).rows[0].id;
    const val = (id: string, p: string, e: string, k: string, v: number) => c.query(
      "INSERT INTO indicator_value (tenant_id,indicator_id,period,period_end,kind,value,workflow_state) VALUES (app.current_tenant(),$1,$2,$3,$4,$5,'validated')", [id, p, e, k, v]);
    indId = await ind('BAD', null, 'unverified');                        // pic Q2 + trou Q3 + retard Q4 (as_of 2026-12-01 : Q4 pas encore dû)
    await val(indId, 'Q1', '2026-03-31', 'actual', 10); await val(indId, 'Q2', '2026-06-30', 'actual', 100); await val(indId, 'Q4', '2026-12-31', 'actual', 120);
    cleanId = await ind('GOOD', 'MIS', 'verified');
    for (const [p, e, t, a] of [['Q1', '2026-03-31', 100, 90], ['Q2', '2026-06-30', 200, 180], ['Q3', '2026-09-30', 300, 270]] as const) { await val(cleanId, p, e, 'target', t); await val(cleanId, p, e, 'actual', a); }
  });
});
after(async () => { await app.close(); await pool.end(); });

test('scores en lecture seule : mauvais indicateur < bon indicateur ; rien n\'est écrit', async () => {
  const rev = await tok('rick', T1, ['viewer']);
  const s = (await call('GET', `/dqa/scores?project_id=${projectId}&as_of=${ASOF}`, rev)).body;
  const bad = s.find((x: any) => x.code === 'BAD'), good = s.find((x: any) => x.code === 'GOOD');
  assert.equal(good.score, 100); assert.ok(bad.score < 60, `bad ${bad.score}`);
  assert.equal((await call('GET', '/dqa/issues', rev)).body.length, 0);
});

let spikeId = '';
test('run : anomalies détectées, idempotent, filtrable ; droits', async () => {
  const entry = await tok('dana', T1, ['data_entry']), rev = await tok('rick', T1, ['reviewer']);
  assert.equal((await call('POST', '/dqa/run', entry, {})).status, 403);
  const r1 = (await call('POST', '/dqa/run', rev, { project_id: projectId, as_of: ASOF })).body;
  assert.ok(r1.detected >= 5); assert.equal(r1.indicators, 2);
  const open1 = (await call('GET', '/dqa/issues?status=open', rev)).body;
  const codes = open1.map((i: any) => `${i.indicator_code}:${i.code}${i.period ? '@' + i.period : ''}`);
  for (const k of ['BAD:no_source', 'BAD:unverified', 'BAD:spike@Q2', 'BAD:missing_period@2026-09-30', 'BAD:no_target@Q1']) assert.ok(codes.includes(k), `${k} manquant dans ${codes}`);
  assert.ok(!codes.some((c: string) => c.startsWith('GOOD')));
  assert.equal(open1[0].severity, 'error');                                   // erreurs d'abord
  const r2 = (await call('POST', '/dqa/run', rev, { project_id: projectId, as_of: ASOF })).body;
  assert.equal((await call('GET', '/dqa/issues?status=open', rev)).body.length, open1.length);   // idempotent
  assert.equal(r2.auto_resolved, 0);
  assert.ok((await call('GET', '/dqa/issues?dimension=accuracy', rev)).body.every((i: any) => i.dimension === 'accuracy'));
  spikeId = open1.find((i: any) => i.code === 'spike').id;
});

test('clôture : action corrective obligatoire, dérogation réservée aux managers, réouverture si le problème persiste', async () => {
  const rev = await tok('rick', T1, ['reviewer']), mgr = await tok('mgr', T1, ['me_manager']), entry = await tok('dana', T1, ['data_entry']);
  assert.equal((await call('POST', `/dqa/issues/${spikeId}/close`, entry, { status: 'resolved', corrective_action: 'vérifié sur le terrain' })).status, 403);
  assert.equal((await call('POST', `/dqa/issues/${spikeId}/close`, rev, { status: 'resolved', corrective_action: 'ok' })).status, 400);       // trop court
  assert.equal((await call('POST', `/dqa/issues/${spikeId}/close`, rev, { status: 'waived', corrective_action: 'dérogation exceptionnelle' })).status, 403);
  assert.equal((await call('POST', `/dqa/issues/${spikeId}/close`, rev, { status: 'resolved', corrective_action: 'valeur confirmée par la mission terrain' })).status, 200);
  assert.equal((await call('POST', `/dqa/issues/${spikeId}/close`, rev, { status: 'resolved', corrective_action: 'deuxième clôture' })).status, 404);  // déjà clos
  await call('POST', '/dqa/run', rev, { project_id: projectId, as_of: ASOF });
  const again = (await call('GET', `/dqa/issues?indicator_id=${indId}`, rev)).body.find((i: any) => i.code === 'spike');
  assert.equal(again.status, 'open');                                         // la détection persiste => rouverte
  assert.equal((await call('POST', `/dqa/issues/${spikeId}/close`, mgr, { status: 'waived', corrective_action: 'dérogation validée par le directeur' })).status, 200);
  await call('POST', '/dqa/run', rev, { project_id: projectId, as_of: ASOF });
  assert.equal((await call('GET', `/dqa/issues?status=waived`, rev)).body.length, 1);   // dérogation conservée malgré la ré-exécution
});

test('règle configurable + clôture automatique quand la condition disparaît', async () => {
  const mgr = await tok('mgr', T1, ['me_manager']), rev = await tok('rick', T1, ['reviewer']);
  assert.equal((await call('PUT', `/dqa/rules/${indId}`, rev, { max_change_ratio: 50 })).status, 403);
  assert.equal((await call('PUT', `/dqa/rules/${indId}`, mgr, { min_value: 10, max_value: 1 })).status, 409);   // CHECK min<=max
  assert.equal((await call('PUT', `/dqa/rules/${indId}`, mgr, { max_change_ratio: 50 })).status, 200);
  const before = (await call('GET', `/dqa/issues?indicator_id=${indId}&status=open`, rev)).body.find((i: any) => i.code === 'missing_period');
  assert.ok(before, 'trou Q3 attendu');
  // la valeur manquante est saisie : la condition disparaît
  await withTenant(pool, SEED, (c) => c.query(
    "INSERT INTO indicator_value (tenant_id,indicator_id,period,period_end,kind,value,workflow_state) VALUES (app.current_tenant(),$1,'Q3','2026-09-30','actual',60,'validated')", [indId]));
  const r = (await call('POST', '/dqa/run', rev, { project_id: projectId, as_of: ASOF })).body;
  assert.ok(r.auto_resolved >= 1);
  const all = (await call('GET', `/dqa/issues?indicator_id=${indId}`, rev)).body;
  const gap = all.find((i: any) => i.code === 'missing_period');
  assert.equal(gap.status, 'resolved'); assert.equal(gap.resolved_by, 'system');
  assert.equal(all.find((i: any) => i.code === 'spike').status, 'waived');   // la dérogation humaine prime sur le recalcul
});

test('isolation tenant et validation', async () => {
  const other = await tok('o', T2, ['me_manager']);
  assert.deepEqual((await call('GET', '/dqa/issues', other)).body, []);
  assert.deepEqual((await call('GET', '/dqa/scores', other)).body, []);
  assert.equal((await call('POST', `/dqa/issues/${spikeId}/close`, other, { status: 'resolved', corrective_action: 'tentative inter-tenant' })).status, 404);
  assert.equal((await call('GET', '/dqa/scores?as_of=nope', other)).status, 400);
  assert.equal((await call('PUT', `/dqa/rules/${indId}`, other, { max_value: 5 })).status, 422);   // FK : indicateur d'un autre tenant
});
