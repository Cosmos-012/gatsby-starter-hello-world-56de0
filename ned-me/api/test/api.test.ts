import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import pg from 'pg';
import { makePool } from '../src/db.ts';
import { makeVerifier } from '../src/auth.ts';
import { buildApp } from '../src/app.ts';

const ADMIN = process.env.ADMIN_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const DB = 'ned_api_test';
const SECRET = 'test-secret-test-secret-test-secret';
const T1 = 'aaaaaaaa-0000-0000-0000-000000000001', T2 = 'bbbbbbbb-0000-0000-0000-000000000002';
const dir = new URL('../../db/migrations/', import.meta.url);
let pool: pg.Pool, app: ReturnType<typeof buildApp>;
let projectA = '', indicatorA = '';

const tok = (sub: string, tenant: string, roles: string[]) =>
  new SignJWT({ tenant_id: tenant, roles }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
const call = async (method: string, url: string, token?: string, payload?: unknown) => {
  const r = await app.inject({ method: method as 'GET', url, payload: payload as object, headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
};

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN }); await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB}`); await admin.query(`CREATE DATABASE ${DB}`); await admin.end();
  const owner = new pg.Client({ connectionString: ADMIN.replace(/\/[^/]*$/, `/${DB}`) }); await owner.connect();
  for (const f of ['001_foundation', '002_results_indicators', '004_arabic_search', '005_workflow']) await owner.query(readFileSync(new URL(`${f}.sql`, dir), 'utf8'));
  await owner.query(`DROP ROLE IF EXISTS ned_api_login; CREATE ROLE ned_api_login LOGIN PASSWORD 'x' IN ROLE ned_app`);
  await owner.query(`INSERT INTO tenant (id,name) VALUES ('${T1}','A'),('${T2}','B')`);
  await owner.query(`INSERT INTO program (tenant_id,code,name) VALUES ('${T1}','P','{"fr":"p"}'),('${T2}','P','{"fr":"p"}')`);
  await owner.end();
  pool = makePool(ADMIN.replace(/\/\/[^@]*@/, '//ned_api_login:x@').replace(/\/[^/]*$/, `/${DB}`));
  app = buildApp(pool, makeVerifier({ secret: SECRET }));
});
after(async () => { await app.close(); await pool.end(); });

test('401 sans jeton ou avec jeton invalide', async () => {
  assert.equal((await call('GET', '/projects')).status, 401);
  assert.equal((await call('GET', '/projects', 'garbage')).status, 401);
  assert.equal((await call('GET', '/health')).status, 200);
});

test('rôle viewer ne peut pas créer un projet; manager oui', async () => {
  const su = await pool.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');
  assert.deepEqual(su.rows[0], { rolsuper: false, rolbypassrls: false });  // le test tourne bien sous RLS
  const viewer = await tok('v', T1, ['viewer']);
  assert.equal((await call('POST', '/projects', viewer, {})).status, 403);
  const mgr = await tok('mgr', T1, ['me_manager']);
  const programId = (await withProgram(T1)).id;
  const r = await call('POST', '/projects', mgr, { program_id: programId, code: 'PRJ', name: { ar: 'خدمات رقمية' } });
  assert.equal(r.status, 201); projectA = r.body.id;
  assert.equal((await call('POST', '/projects', mgr, { program_id: programId, code: 'X', name: {} })).status, 400);
});

async function withProgram(tenant: string) {
  const c = await pool.connect();
  try { await c.query('BEGIN'); await c.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]);
    const r = (await c.query('SELECT id FROM program LIMIT 1')).rows[0]; await c.query('COMMIT'); return r; } finally { c.release(); }
}

test('isolation : tenant B ne voit pas les projets de A ni ne peut y rattacher', async () => {
  const b = await tok('bob', T2, ['me_manager']);
  assert.deepEqual((await call('GET', '/projects', b)).body, []);
  const progA = (await withProgram(T1)).id;
  const r = await call('POST', '/projects', b, { program_id: progA, code: 'EVIL', name: { fr: 'x' } });
  assert.ok([422, 403].includes(r.status), `status ${r.status}`);
});

test('jeton avec tenant_id inexistant ne voit rien', async () => {
  const t = await tok('ghost', 'cccccccc-0000-0000-0000-000000000003', ['viewer']);
  assert.deepEqual((await call('GET', '/projects', t)).body, []);
});

test('workflow de bout en bout + séparation des tâches + statut calculé', async () => {
  const mgr = await tok('mgr', T1, ['me_manager']);
  // indicateur créé directement par le propriétaire (CRUD indicateur = phase suivante)
  const c = await pool.connect();
  await c.query('BEGIN'); await c.query("SELECT set_config('app.tenant_id',$1,true)", [T1]);
  indicatorA = (await c.query("INSERT INTO indicator (tenant_id,project_id,code,name,baseline) VALUES (app.current_tenant(),$1,'IND1','{\"fr\":\"i\"}',0) RETURNING id", [projectA])).rows[0].id;
  await c.query('COMMIT'); c.release();

  const entry = await tok('dana', T1, ['data_entry']);
  const rev = await tok('rick', T1, ['reviewer']);
  const mk = (kind: string, value: number) => call('POST', '/indicator-values', entry, { indicator_id: indicatorA, period: '2026-Q1', period_end: '2026-03-31', kind, value });
  const target = (await mk('target', 100)).body.id, actual = (await mk('actual', 80)).body.id;

  // un draft ne compte pas : statut GRIS
  let p = await call('GET', `/indicators/progress?project_id=${projectA}`, mgr);
  assert.equal(p.body[0].status, 'GREY');

  const tr = (id: string, to: string, t: string) => call('POST', `/indicator-values/${id}/transition`, t, { to });
  assert.equal((await tr(actual, 'validated', entry)).status, 409);          // saut interdit
  assert.equal((await tr(actual, 'submitted', entry)).status, 200);
  assert.equal((await tr(actual, 'review', entry)).status, 403);             // data_entry ne relit pas
  assert.equal((await tr(actual, 'review', rev)).status, 200);
  assert.equal((await tr(actual, 'validated', rev)).status, 200);
  // cible : même chaîne par le manager, puis auto-validation interdite
  await tr(target, 'submitted', entry); await tr(target, 'review', rev); await tr(target, 'validated', rev);
  assert.equal((await tr(actual, 'approved', rev)).status, 403);             // reviewer n'approuve pas
  // ségrégation : celui qui a soumis ne peut pas approuver (même avec le bon rôle)
  const dualRole = await tok('dana', T1, ['data_entry', 'me_manager']);
  assert.equal((await tr(actual, 'approved', dualRole)).status, 403);
  assert.equal((await tr(actual, 'approved', mgr)).status, 200);
  assert.equal((await tr(target, 'approved', mgr)).status, 200);

  p = await call('GET', `/indicators/progress?project_id=${projectA}`, mgr);
  assert.equal(p.body[0].status, 'AMBER');   // 80/100 = 0.8
  assert.equal(p.body[0].achievement, 0.8);
  assert.equal((await call('GET', '/indicators/progress?status=RED', mgr)).body.length, 0);

  const c2 = await pool.connect();
  await c2.query('BEGIN'); await c2.query("SELECT set_config('app.tenant_id',$1,true)", [T1]);
  const ev = (await c2.query('SELECT to_state, actor FROM workflow_event WHERE value_id = $1 ORDER BY id', [actual])).rows;
  await c2.query('COMMIT'); c2.release();
  assert.deepEqual(ev.map((e) => e.to_state), ['submitted', 'review', 'validated', 'approved']);
  assert.deepEqual(ev.map((e) => e.actor), ['dana', 'rick', 'rick', 'mgr']);
});

test('entrée invalide refusée (400) ', async () => {
  const entry = await tok('dana', T1, ['data_entry']);
  const r = await call('POST', '/indicator-values', entry, { indicator_id: 'nope', period: '2026-Q1', period_end: '2026-03-31', kind: 'actual', value: 1 });
  assert.equal(r.status, 400);
});
