import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import pg from 'pg';
import { makePool, withTenant } from '../src/db.ts';
import { makeVerifier } from '../src/auth.ts';
import { buildApp } from '../src/app.ts';

const ADMIN = process.env.ADMIN_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const DB = 'ned_trk_test', SECRET = 'test-secret-test-secret-test-secret';
const T1 = 'aaaaaaaa-0000-0000-0000-000000000001';
const dir = new URL('../../db/migrations/', import.meta.url);
let pool: pg.Pool, app: ReturnType<typeof buildApp>, projectId: string, orgId: string;
const P = { sub: 'seed', tenantId: T1, roles: [] as string[] };

const tok = (roles: string[]) => new SignJWT({ tenant_id: T1, roles }).setProtectedHeader({ alg: 'HS256' }).setSubject('u').setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
const get = async (url: string) => { const r = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${await tok(['viewer'])}` } }); return { status: r.statusCode, body: JSON.parse(r.body) }; };

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN }); await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB}`); await admin.query(`CREATE DATABASE ${DB}`); await admin.end();
  const owner = new pg.Client({ connectionString: ADMIN.replace(/\/[^/]*$/, `/${DB}`) }); await owner.connect();
  for (const f of ['001_foundation', '002_results_indicators', '004_arabic_search', '005_workflow']) await owner.query(readFileSync(new URL(`${f}.sql`, dir), 'utf8'));
  await owner.query(`DROP ROLE IF EXISTS ned_trk_login; CREATE ROLE ned_trk_login LOGIN PASSWORD 'x' IN ROLE ned_app`);
  await owner.query(`INSERT INTO tenant (id,name) VALUES ('${T1}','A')`);
  await owner.end();
  pool = makePool(ADMIN.replace(/\/\/[^@]*@/, '//ned_trk_login:x@').replace(/\/[^/]*$/, `/${DB}`));
  app = buildApp(pool, makeVerifier({ secret: SECRET }));
  await withTenant(pool, P, async (c) => {
    orgId = (await c.query("INSERT INTO organisation (tenant_id,name) VALUES (app.current_tenant(),'O') RETURNING id")).rows[0].id;
    const prog = (await c.query("INSERT INTO program (tenant_id,code,name) VALUES (app.current_tenant(),'P','{\"fr\":\"p\"}') RETURNING id")).rows[0].id;
    projectId = (await c.query("INSERT INTO project (tenant_id,program_id,code,name) VALUES (app.current_tenant(),$1,'J','{\"fr\":\"j\"}') RETURNING id", [prog])).rows[0].id;
    const ind = async (code: string, org: string | null, baseline: number, dir = 'increase') =>
      (await c.query("INSERT INTO indicator (tenant_id,project_id,code,name,baseline,direction,responsible_org_id) VALUES (app.current_tenant(),$1,$2,'{\"fr\":\"x\"}',$3,$4,$5) RETURNING id", [projectId, code, baseline, dir, org])).rows[0].id;
    const val = (id: string, period: string, end: string, kind: string, v: number, state: string, dims = {}) =>
      c.query('INSERT INTO indicator_value (tenant_id,indicator_id,period,period_end,kind,value,workflow_state,dimensions) VALUES (app.current_tenant(),$1,$2,$3,$4,$5,$6,$7)', [id, period, end, kind, v, state, dims]);
    // A : croissance linéaire 10→20→30, cible finale 100 : en retard (prévision 40 sur 100 à 2026-12-31 ≈ bien plus bas)
    const a = await ind('A', orgId, 0);
    for (const [pe, d, v] of [['2026-Q1', '2026-03-31', 10], ['2026-Q2', '2026-06-30', 20], ['2026-Q3', '2026-09-30', 30]] as const) await val(a, pe, d, 'actual', v, 'validated');
    await val(a, '2026-Q3', '2026-09-30', 'target', 35, 'approved'); await val(a, '2026-Q4', '2026-12-31', 'target', 100, 'approved');
    await val(a, '2026-Q3', '2026-09-30', 'actual', 99, 'draft', { region: 'Nord' });  // bruit : tranche région non validée
    // B : sur la cible, par région validée
    const b = await ind('B', null, 0);
    await val(b, '2026-Q1', '2026-03-31', 'target', 100, 'approved'); await val(b, '2026-Q1', '2026-03-31', 'actual', 95, 'validated');
    await val(b, '2026-Q1', '2026-03-31', 'target', 50, 'approved', { region: 'Nord' }); await val(b, '2026-Q1', '2026-03-31', 'actual', 20, 'validated', { region: 'Nord' });
    // C : décroissant (baseline 30 → cible 10), actual 20 = 50 %
    const cc = await ind('C', null, 30, 'decrease');
    await val(cc, '2026-Q1', '2026-03-31', 'target', 10, 'approved'); await val(cc, '2026-Q1', '2026-03-31', 'actual', 20, 'published');
    await ind('D', null, 0);   // sans donnée
  });
});
after(async () => { await app.close(); await pool.end(); });

const by = (rows: any[], code: string) => rows.find((r) => r.code === code);

test('table de suivi : valeurs, écart, statut, tendance, prévision', async () => {
  const { status, body } = await get(`/indicators/tracking?project_id=${projectId}`);
  assert.equal(status, 200); assert.equal(body.length, 4);
  const a = by(body, 'A');
  assert.equal(a.actual, 30); assert.equal(a.target, 35); assert.equal(a.gap, -5);
  assert.equal(a.status, 'AMBER');                       // 30/35 = 0.857
  assert.equal(a.trend, 'improving');
  assert.ok(Math.abs(a.forecast - 40.07) < 0.01, `forecast ${a.forecast}`);   // régression sur 3 points, à 2026-12-31
  assert.equal(a.forecast_final_target, 100); assert.equal(a.at_risk, true);
  assert.equal(by(body, 'B').status, 'GREEN'); assert.equal(by(body, 'B').achievement, 0.95);
  assert.equal(by(body, 'C').achievement, 0.5);           // décroissant : (30-20)/(30-10)
  assert.equal(by(body, 'C').status, 'RED');              // valeur 'published' compte
  const d = by(body, 'D'); assert.equal(d.status, 'GREY'); assert.equal(d.actual, null); assert.equal(d.trend, 'insufficient');
});

test('le brouillon de la tranche région ne fuit pas dans les totaux ; la tranche validée est exacte', async () => {
  const nord = (await get(`/indicators/tracking?project_id=${projectId}&dimensions=${encodeURIComponent('{"region":"Nord"}')}`)).body;
  assert.equal(by(nord, 'A').status, 'GREY');             // seul un brouillon existe pour Nord
  assert.equal(by(nord, 'B').actual, 20); assert.equal(by(nord, 'B').status, 'RED');   // 20/50 = 0.4
});

test('filtres : statut, organisation, période, dimensions invalides', async () => {
  const red = (await get(`/indicators/tracking?project_id=${projectId}&status=RED`)).body;
  assert.deepEqual(red.map((r: any) => r.code), ['C']);
  const org = (await get(`/indicators/tracking?org_id=${orgId}`)).body;
  assert.deepEqual(org.map((r: any) => r.code), ['A']);
  const q2 = by((await get(`/indicators/tracking?project_id=${projectId}&period=2026-Q2`)).body, 'A');
  assert.equal(q2.actual, 20); assert.equal(q2.status, 'GREY');        // pas de cible Q2
  assert.equal((await get('/indicators/tracking?dimensions=not-json')).status, 400);
  assert.equal((await get('/indicators/tracking?project_id=nope')).status, 400);
});
