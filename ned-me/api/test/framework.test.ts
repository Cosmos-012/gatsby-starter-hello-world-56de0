import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import pg from 'pg';
import { makePool } from '../src/db.ts';
import { makeVerifier } from '../src/auth.ts';
import { buildApp } from '../src/app.ts';

const ADMIN = process.env.ADMIN_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const DB = 'ned_fw_test', SECRET = 'test-secret-test-secret-test-secret';
const T1 = 'aaaaaaaa-0000-0000-0000-000000000001', T2 = 'bbbbbbbb-0000-0000-0000-000000000002';
const dir = new URL('../../db/migrations/', import.meta.url);
let pool: pg.Pool, app: ReturnType<typeof buildApp>;

const tok = (sub: string, tenant: string, roles: string[]) =>
  new SignJWT({ tenant_id: tenant, roles }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
const call = async (method: string, url: string, token: string, payload?: unknown) => {
  const r = await app.inject({ method: method as 'GET', url, payload: payload as object, headers: { authorization: `Bearer ${token}` } });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
};

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN }); await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB}`); await admin.query(`CREATE DATABASE ${DB}`); await admin.end();
  const owner = new pg.Client({ connectionString: ADMIN.replace(/\/[^/]*$/, `/${DB}`) }); await owner.connect();
  for (const f of ['001_foundation', '002_results_indicators', '004_arabic_search', '005_workflow']) await owner.query(readFileSync(new URL(`${f}.sql`, dir), 'utf8'));
  await owner.query(`DROP ROLE IF EXISTS ned_fw_login; CREATE ROLE ned_fw_login LOGIN PASSWORD 'x' IN ROLE ned_app`);
  await owner.query(`INSERT INTO tenant (id,name) VALUES ('${T1}','A'),('${T2}','B')`);
  await owner.end();
  pool = makePool(ADMIN.replace(/\/\/[^@]*@/, '//ned_fw_login:x@').replace(/\/[^/]*$/, `/${DB}`));
  app = buildApp(pool, makeVerifier({ secret: SECRET }));
});
after(async () => { await app.close(); await pool.end(); });

test('cadre complet : org → programme → projet → composante → résultats → indicateurs → arbre', async () => {
  const mgr = await tok('mgr', T1, ['me_manager']);
  const org = (await call('POST', '/organisations', mgr, { name: 'PMU Nationale', kind: 'pmu' })).body;
  const prog = (await call('POST', '/programs', mgr, { code: 'DT', name: { fr: 'Transformation numérique', ar: 'التحول الرقمي' }, owner_org_id: org.id })).body;
  const proj = (await call('POST', '/projects', mgr, { program_id: prog.id, code: 'SNN', name: { fr: 'Services numériques nationaux' } })).body;
  const comp = await call('POST', `/projects/${proj.id}/components`, mgr, { code: 'C1', name: { fr: 'Infrastructure' } });
  assert.equal(comp.status, 201);

  const mkRes = (b: object) => call('POST', `/projects/${proj.id}/results`, mgr, b);
  const imp = (await mkRes({ level: 'impact', code: 'I1', name: { fr: 'Meilleurs services publics' } })).body;
  const oc = (await mkRes({ level: 'outcome', code: 'O1', name: { fr: 'Accès accru' }, parent_id: imp.id, component_id: comp.body.id })).body;
  const out = (await mkRes({ level: 'output', code: 'OP1', name: { fr: 'Portail déployé' }, parent_id: oc.id })).body;
  // hiérarchie inversée refusée (409 : check_violation)
  assert.equal((await mkRes({ level: 'impact', code: 'BAD', name: { fr: 'x' }, parent_id: out.id })).status, 409);

  const ind = await call('POST', '/indicators', mgr, { project_id: proj.id, result_id: out.id, code: 'IND-1', unit: '%', baseline: 10,
    name: { ar: 'عدد المستفيدين من الخدمات الرقمية', fr: 'Bénéficiaires' } });
  assert.equal(ind.status, 201);
  assert.equal((await call('POST', '/indicators', mgr, { project_id: proj.id, code: 'IND-1', name: { fr: 'dup' } })).status, 409);

  const tree = (await call('GET', `/projects/${proj.id}/results/tree`, mgr)).body;
  assert.equal(tree.length, 1);
  assert.equal(tree[0].code, 'I1');
  assert.equal(tree[0].children[0].children[0].code, 'OP1');
  assert.equal(tree[0].children[0].children[0].indicators[0].code, 'IND-1');

  // recherche arabe sans tashkeel et avec ta marbuta/alef normalisés
  const found = await call('GET', `/indicators?project_id=${proj.id}&search=${encodeURIComponent('المُستفيدين')}`, mgr);
  assert.equal(found.body.length, 1);
  assert.equal(found.body[0].baseline, 10);
  assert.equal((await call('GET', `/indicators?search=${encodeURIComponent('غير موجود')}`, mgr)).body.length, 0);
});

test('droits et isolation sur le cadre', async () => {
  const viewer = await tok('v', T1, ['viewer']);
  assert.equal((await call('POST', '/programs', viewer, { code: 'X', name: { fr: 'x' } })).status, 403);
  assert.equal((await call('GET', '/programs', viewer)).body.length, 1);
  const other = await tok('o', T2, ['me_manager']);
  assert.equal((await call('GET', '/programs', other)).body.length, 0);
  assert.equal((await call('GET', '/indicators', other)).body.length, 0);
  const projA = (await call('GET', '/projects', viewer)).body[0].id;
  assert.equal((await call('GET', `/projects/${projA}/results/tree`, other)).body.length, 0);
  const r = await call('POST', `/projects/${projA}/results`, other, { level: 'impact', code: 'Z', name: { fr: 'z' } });
  assert.ok([422, 403].includes(r.status));
  assert.equal((await call('POST', '/programs', other, { code: 'Y', name: {} })).status, 400);
});
