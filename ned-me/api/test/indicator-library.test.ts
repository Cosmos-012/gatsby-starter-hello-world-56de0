import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import pg from 'pg';
import { allMigrations } from './migrations.ts';
import { makePool } from '../src/db.ts';
import { makeVerifier } from '../src/auth.ts';
import { buildApp } from '../src/app.ts';

const ADMIN = process.env.ADMIN_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const DB = 'ned_lib_test', SECRET = 'test-secret-test-secret-test-secret';
const T1 = 'aaaaaaaa-0000-0000-0000-000000000001', T2 = 'bbbbbbbb-0000-0000-0000-000000000002';
let pool: pg.Pool, app: ReturnType<typeof buildApp>, P1: string, P2: string;

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
  for (const sql of allMigrations()) await owner.query(sql);
  await owner.query(`DROP ROLE IF EXISTS ned_lib_login; CREATE ROLE ned_lib_login LOGIN PASSWORD 'x' IN ROLE ned_app`);
  await owner.query(`INSERT INTO tenant (id,name) VALUES ('${T1}','A'),('${T2}','B')`);
  await owner.end();
  pool = makePool(ADMIN.replace(/\/\/[^@]*@/, '//ned_lib_login:x@').replace(/\/[^/]*$/, `/${DB}`));
  app = buildApp(pool, makeVerifier({ secret: SECRET }));
  const m1 = await tok('m1', T1, ['me_manager']), m2 = await tok('m2', T2, ['me_manager']);
  const g1 = (await call('POST', '/programs', m1, { code: 'G', name: { fr: 'P' } })).body.id, g2 = (await call('POST', '/programs', m2, { code: 'G', name: { fr: 'P' } })).body.id;
  P1 = (await call('POST', '/projects', m1, { program_id: g1, code: 'P1', name: { fr: 'Un' } })).body.id;
  P2 = (await call('POST', '/projects', m2, { program_id: g2, code: 'P2', name: { fr: 'Deux' } })).body.id;
});
after(async () => { await app.close(); await pool.end(); });

const DEFN = { code: 'UNEMP', title: { fr: 'Taux de chômage', en: 'Unemployment rate' }, unit: '%', type: 'percentage', direction: 'decrease', frequency: 'annual',
  aggregation: 'latest', disaggregations: ['sex', 'region'], sdg_target: '8.5.2', iati_code: 'x-unemp', data_source: 'Enquête emploi' };

test('fiche : création, validation (ratio, code, ODD), droits, unicité, isolation entre clients', async () => {
  const mgr = await tok('m1', T1, ['me_manager']), viewer = await tok('v', T1, ['viewer']);
  const ok = await call('POST', '/indicator-definitions', mgr, DEFN);
  assert.equal(ok.status, 201); assert.equal(ok.body.direction, 'decrease'); assert.deepEqual(ok.body.disaggregations, ['sex', 'region']);
  assert.equal((await call('POST', '/indicator-definitions', mgr, DEFN)).status, 409);                                            // code déjà pris
  assert.equal((await call('POST', '/indicator-definitions', viewer, { ...DEFN, code: 'X1' })).status, 403);
  assert.equal((await call('POST', '/indicator-definitions', mgr, { ...DEFN, code: 'R1', type: 'ratio' })).status, 400);          // ratio sans numérateur/dénominateur
  assert.equal((await call('POST', '/indicator-definitions', mgr, { ...DEFN, code: 'bad code!' })).status, 400);
  assert.equal((await call('POST', '/indicator-definitions', mgr, { ...DEFN, code: 'S1', sdg_target: 'huit' })).status, 400);
  assert.equal((await call('POST', '/indicator-definitions', mgr, { ...DEFN, code: 'R2', title: { fr: 'Ratio de test' }, sdg_target: undefined, type: 'ratio', numerator_def: 'a', denominator_def: 'b', direction: 'increase' })).status, 201);
  const list = (await call('GET', '/indicator-definitions?search=chômage', viewer)).body;                                          // recherche multilingue, lecture ouverte
  assert.equal(list.length, 1); assert.equal(list[0].code, 'UNEMP'); assert.equal(list[0].used_by, 0);
  assert.equal((await call('GET', '/indicator-definitions?sdg=8', viewer)).body.length, 1);                                      // ODD 8 (cible 8.5.2) ; R2 n'a pas d'ODD
  const other = await tok('m2', T2, ['me_manager']);
  assert.deepEqual((await call('GET', '/indicator-definitions', other)).body, []);                                                // un autre client ne voit rien
  assert.equal((await call('GET', `/indicator-definitions/${ok.body.id}`, other)).status, 404);
  assert.equal((await call('POST', '/indicator-definitions', other, DEFN)).status, 201);                                          // même code possible chez un autre client
});

test('indicateur créé depuis une fiche : champs copiés (dont le sens « décroissant »), surcharge possible, retrait sans effet rétroactif', async () => {
  const mgr = await tok('m1', T1, ['me_manager']);
  const def = (await call('GET', '/indicator-definitions?search=UNEMP', mgr)).body[0];
  const made = await call('POST', '/indicators', mgr, { project_id: P1, code: 'U1', definition_id: def.id });
  assert.equal(made.status, 201);
  const ind = (await call('GET', `/indicators/${made.body.id}`, mgr)).body;
  assert.deepEqual(ind.name, { fr: 'Taux de chômage', en: 'Unemployment rate' });
  assert.equal(ind.direction, 'decrease'); assert.equal(ind.unit, '%'); assert.equal(ind.frequency, 'annual'); assert.equal(ind.data_source, 'Enquête emploi');
  const over = await call('POST', '/indicators', mgr, { project_id: P1, code: 'U2', definition_id: def.id, unit: 'points', frequency: 'quarterly', name: { fr: 'Chômage des jeunes' } });
  const ind2 = (await call('GET', `/indicators/${over.body.id}`, mgr)).body;
  assert.equal(ind2.unit, 'points'); assert.equal(ind2.frequency, 'quarterly'); assert.equal(ind2.direction, 'decrease'); assert.deepEqual(ind2.name, { fr: 'Chômage des jeunes' });
  assert.equal((await call('GET', `/indicator-definitions?search=UNEMP`, mgr)).body[0].used_by, 2);

  // le sens décroissant de la fiche est bien appliqué au calcul : baseline 25, cible 20, réalisé 21,6 → 68 %, pas 108 %
  const de = await tok('de', T1, ['data_entry']), rev = await tok('rev', T1, ['reviewer']);
  const vals: string[] = [];
  for (const kind of ['target', 'actual']) {
    const v = await call('POST', '/indicator-values', de, { indicator_id: made.body.id, period: '2026', period_end: '2026-12-31', kind, value: kind === 'target' ? 20 : 21.6 });
    vals.push(v.body.id);
    for (const [who, to] of [[de, 'submitted'], [rev, 'review'], [rev, 'validated'], [mgr, 'approved']] as const)
      assert.equal((await call('POST', `/indicator-values/${v.body.id}/transition`, who, { to })).status, 200, `${kind} → ${to}`);   // parcours réel : séparation des tâches respectée
  }
  const owner = new pg.Client({ connectionString: ADMIN.replace(/\/[^/]*$/, `/${DB}`) }); await owner.connect();
  await owner.query(`UPDATE indicator SET baseline = 25 WHERE id = '${made.body.id}'`); await owner.end();
  const row = (await call('GET', `/indicators/tracking?project_id=${P1}`, mgr)).body.find((r: any) => r.code === 'U1');
  assert.equal(row.achievement, 0.68); assert.equal(row.status, 'AMBER');

  assert.equal((await call('POST', `/indicator-definitions/${def.id}/retire`, mgr)).status, 200);
  assert.equal((await call('POST', '/indicators', mgr, { project_id: P1, code: 'U3', definition_id: def.id })).status, 409);       // fiche retirée : plus de création
  assert.equal((await call('GET', `/indicators/${made.body.id}`, mgr)).body.direction, 'decrease');                              // l'existant est intact
  assert.equal((await call('POST', '/indicators', mgr, { project_id: P1, code: 'N1' })).status, 400);                            // ni nom ni fiche
  assert.equal((await call('POST', '/indicators', await tok('m2', T2, ['me_manager']), { project_id: P2, code: 'Z', definition_id: def.id })).status, 409);   // fiche d'un autre client : introuvable
});
