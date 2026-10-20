import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import pg from 'pg';
import { SignJWT } from 'jose';
import { allMigrations } from './migrations.ts';
import { makePool } from '../src/db.ts';
import { makeVerifier } from '../src/auth.ts';
import { buildApp } from '../src/app.ts';
import { registerConnector, runConnector, listConnectors, type Connector } from '../src/connectors/index.ts';
import type { RawRow } from '../src/imports.ts';

const ADMIN = process.env.ADMIN_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const DB = 'ned_conn_test', SECRET = 'test-secret-test-secret-test-secret';
const T1 = 'aaaaaaaa-0000-0000-0000-000000000001', T2 = 'bbbbbbbb-0000-0000-0000-000000000002';
let pool: pg.Pool, app: ReturnType<typeof buildApp>, P1: string;
const who1 = { sub: 'svc', tenantId: T1, roles: ['data_entry'] }, who2 = { sub: 'svc2', tenantId: T2, roles: ['data_entry'] };
const tok = (sub: string, tenant: string, roles: string[]) => new SignJWT({ tenant_id: tenant, roles }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
const call = async (method: string, url: string, token: string, payload?: unknown) => {
  const r = await app.inject({ method: method as 'GET', url, payload: payload as object, headers: { authorization: `Bearer ${token}` } });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
};
const row = (line: number, cells: Record<string, string>): RawRow => ({ line, cells });

// Source externe simulée : ce que serait, par exemple, une lecture de formulaires Kobo déjà convertie au format d'import.
const fake: Connector<{ rows: Record<string, string>[]; fail?: boolean }> = {
  id: 'fake', label: { fr: 'Source simulée', en: 'Simulated source' },
  config: z.object({ rows: z.array(z.record(z.string(), z.string())), fail: z.boolean().optional() }).strict(),
  async pull(cfg) { if (cfg.fail) throw new Error('source injoignable'); return cfg.rows.map((cells, i) => row(i + 1, cells)); },
};
const good = { indicator_code: 'I1', period: '2026-Q1', period_end: '2026-03-31', kind: 'actual', value: '12' };

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN }); await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB}`); await admin.query(`CREATE DATABASE ${DB}`); await admin.end();
  const owner = new pg.Client({ connectionString: ADMIN.replace(/\/[^/]*$/, `/${DB}`) }); await owner.connect();
  for (const sql of allMigrations()) await owner.query(sql);
  await owner.query(`DROP ROLE IF EXISTS ned_conn_login; CREATE ROLE ned_conn_login LOGIN PASSWORD 'x' IN ROLE ned_app`);
  await owner.query(`INSERT INTO tenant (id,name) VALUES ('${T1}','A'),('${T2}','B')`); await owner.end();
  pool = makePool(ADMIN.replace(/\/\/[^@]*@/, '//ned_conn_login:x@').replace(/\/[^/]*$/, `/${DB}`));
  app = buildApp(pool, makeVerifier({ secret: SECRET }));
  const m = await tok('m', T1, ['me_manager']);
  const g = (await call('POST', '/programs', m, { code: 'G', name: { fr: 'P' } })).body.id;
  P1 = (await call('POST', '/projects', m, { program_id: g, code: 'P1', name: { fr: 'Un' } })).body.id;
  await call('POST', '/indicators', m, { project_id: P1, code: 'I1', name: { fr: 'I1' } });
  registerConnector(fake);
});
after(async () => { await app.close(); await pool.end(); });

test('enregistrement : identifiant valide, pas de doublon, liste publique sans configuration', () => {
  assert.throws(() => registerConnector({ ...fake, id: 'Mauvais Id' }), /invalide/);
  assert.throws(() => registerConnector(fake), /déjà enregistré/);
  assert.deepEqual(listConnectors(), [{ id: 'fake', label: { fr: 'Source simulée', en: 'Simulated source' } }]);
});

test('un connecteur passe par le même contrôle que l\'import : brouillons seulement, tout ou rien, jamais d\'écrasement', async () => {
  assert.deepEqual(await runConnector(pool, who1, 'fake', { rows: [good] }, P1), { status: 'ok', inserted: 1 });
  const m = await tok('m', T1, ['me_manager']);
  const ind = (await call('GET', `/indicators?project_id=${P1}`, m)).body[0];
  const det = (await call('GET', `/indicators/${ind.id}`, m)).body;
  assert.equal(det.values.length, 1); assert.equal(det.values[0].workflow_state, 'draft');                          // jamais au-delà du brouillon
  const again = await runConnector(pool, who1, 'fake', { rows: [good] }, P1);                                       // même clé : refusé
  assert.equal(again.status, 'has_errors');
  const mixed = await runConnector(pool, who1, 'fake', { rows: [{ ...good, period: '2026-Q2' }, { ...good, indicator_code: 'ZZ', period: '2026-Q3' }] }, P1);
  assert.equal(mixed.status, 'has_errors');
  assert.equal((await call('GET', `/indicators/${ind.id}`, m)).body.values.length, 1);                              // rien d'écrit, même pour la ligne valide
});

test('erreurs de la source ou de la configuration : refus net, aucune écriture', async () => {
  assert.deepEqual(await runConnector(pool, who1, 'absent', {}, P1), { status: 'failed', reason: 'unknown_connector' });
  const bad = await runConnector(pool, who1, 'fake', { rows: [good], inconnu: 1 }, P1);
  assert.equal(bad.status, 'failed'); assert.equal((bad as any).reason, 'invalid_config');
  const down = await runConnector(pool, who1, 'fake', { rows: [], fail: true }, P1);
  assert.deepEqual(down, { status: 'failed', reason: 'pull_failed', message: 'source injoignable' });
});

test('un connecteur ne sort pas du client de l\'appelant', async () => {
  const r = await runConnector(pool, who2, 'fake', { rows: [{ ...good, period: '2026-Q9' }] }, P1);                  // projet d'un autre client
  assert.deepEqual(r, { status: 'failed', reason: 'unknown_project' });
});
