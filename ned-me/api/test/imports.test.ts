import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import pg from 'pg';
import ExcelJS from 'exceljs';
import { allMigrations } from './migrations.ts';
import { makePool } from '../src/db.ts';
import { makeVerifier } from '../src/auth.ts';
import { buildApp } from '../src/app.ts';
import { parseCsv, parseNumber, toRawRows, judge } from '../src/imports.ts';

const ADMIN = process.env.ADMIN_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const DB = 'ned_imp_test', SECRET = 'test-secret-test-secret-test-secret';
const T1 = 'aaaaaaaa-0000-0000-0000-000000000001', T2 = 'bbbbbbbb-0000-0000-0000-000000000002';
let pool: pg.Pool, app: ReturnType<typeof buildApp>, P1: string;

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
  await owner.query(`DROP ROLE IF EXISTS ned_imp_login; CREATE ROLE ned_imp_login LOGIN PASSWORD 'x' IN ROLE ned_app`);
  await owner.query(`INSERT INTO tenant (id,name) VALUES ('${T1}','A'),('${T2}','B')`);
  await owner.end();
  pool = makePool(ADMIN.replace(/\/\/[^@]*@/, '//ned_imp_login:x@').replace(/\/[^/]*$/, `/${DB}`));
  app = buildApp(pool, makeVerifier({ secret: SECRET }));
  const mgr = await tok('mgr', T1, ['me_manager']);
  const pr = (await call('POST', '/programs', mgr, { code: 'G', name: { fr: 'Prog' } })).body.id;
  P1 = (await call('POST', '/projects', mgr, { program_id: pr, code: 'P1', name: { fr: 'Un' } })).body.id;
  for (const code of ['I1', 'I2']) await call('POST', '/indicators', mgr, { project_id: P1, code, name: { fr: code } });
});
after(async () => { await app.close(); await pool.end(); });

test('CSV : guillemets, champ multiligne, BOM, séparateur « ; », guillemet non fermé refusé', () => {
  assert.deepEqual(parseCsv('﻿a,b\r\n"x,1","y ""q"""\n'), [['a', 'b'], ['x,1', 'y "q"']]);
  assert.deepEqual(parseCsv('a;b\n1;2'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('a,b\n"l1\nl2",z'), [['a', 'b'], ['l1\nl2', 'z']]);
  assert.throws(() => parseCsv('a,b\n"oups,1'), /guillemet/);
});

test('nombres : virgule décimale, séparateurs de milliers ; texte, vide, infini refusés (jamais de valeur devinée)', () => {
  assert.equal(parseNumber('96,5'), 96.5); assert.equal(parseNumber('1 234,5'), 1234.5); assert.equal(parseNumber('1,234.5'), 1234.5);
  assert.equal(parseNumber('-3'), -3); assert.equal(parseNumber('1.234,5'), 1234.5);
  for (const bad of ['', 'abc', '12abc', 'Infinity', 'NaN', '1e3', '--1']) assert.equal(parseNumber(bad), null, bad);
});

test('en-tête : colonnes obligatoires, doublons, limite de lignes', () => {
  assert.throws(() => toRawRows([['indicator_code', 'period']]), /colonnes manquantes/);
  assert.throws(() => toRawRows([['indicator_code', 'period', 'period_end', 'kind', 'value', 'value']]), /double/);
  assert.throws(() => toRawRows([]), /vide/);
  const h = ['indicator_code', 'period', 'period_end', 'kind', 'value'];
  assert.throws(() => toRawRows([h, ...Array.from({ length: 5001 }, () => ['I1', '2026-Q1', '2026-03-31', 'actual', '1'])]), /trop de lignes/);
});

test('jugement : chaque erreur est nommée, doublons du fichier et clés existantes détectés', () => {
  const h = ['indicator_code', 'period', 'period_end', 'kind', 'value', 'dim_region'];
  const raw = toRawRows([h,
    ['I1', '2026-Q1', '2026-03-31', 'actual', '10', 'Nord'], ['I1', '2026-Q1', '2026-03-31', 'actual', '11', 'Nord'],   // doublon
    ['ZZ', '2026-Q1', '2026-03-31', 'actual', '1', ''], ['I1', 'Q', '2026-02-30', 'moyenne', 'x', ''],
    ['I2', '2026-Q1', '2026-03-31', 'target', '5', '']]);
  const existing = new Set([JSON.stringify(['I2', '2026-Q1', 'target', []])]);
  const r = judge(raw, new Set(['I1', 'I2']), existing);
  assert.equal(r[0].ok, true); assert.deepEqual(r[0].row!.dimensions, { region: 'Nord' });
  assert.match(r[1].errors.join(), /doublon dans le fichier/);
  assert.match(r[2].errors.join(), /indicateur inconnu/);
  assert.equal(r[3].errors.length, 4);                                                                                   // période, date, nature, valeur
  assert.match(r[4].errors.join(), /existe déjà/);
});

const CSV = (rows: string[]) => ['indicator_code,period,period_end,kind,value,comment,dim_region', ...rows].join('\n');

test('API : aperçu sans écriture, validation tout-ou-rien, valeurs en brouillon, aucun écrasement', async () => {
  const entry = await tok('de', T1, ['data_entry']);
  const good = CSV(['I1,2026-Q1,2026-03-31,actual,"96,5",ok,Nord', 'I1,2026-Q1,2026-03-31,target,100,,Nord', 'I2,2026-Q1,2026-03-31,actual,7,,']);
  const pv = await call('POST', '/imports/indicator-values/preview', entry, { project_id: P1, format: 'csv', content: good });
  assert.equal(pv.status, 200); assert.equal(pv.body.total, 3); assert.equal(pv.body.ok, 3); assert.equal(pv.body.errors, 0);
  assert.equal((await call('GET', `/indicators/${(await call('GET', `/indicators?project_id=${P1}`, entry)).body[0].id}`, entry)).body.values.length, 0);   // aperçu : rien écrit

  const mixed = CSV(['I1,2026-Q2,2026-06-30,actual,50,,', 'I1,2026-Q2,2026-06-30,actual,abc,,']);
  const bad = await call('POST', '/imports/indicator-values/commit', entry, { project_id: P1, format: 'csv', content: mixed });
  assert.equal(bad.status, 422); assert.equal(bad.body.errors, 1);                                                      // une erreur : rien n'est écrit

  const ok = await call('POST', '/imports/indicator-values/commit', entry, { project_id: P1, format: 'csv', content: good });
  assert.equal(ok.status, 201); assert.equal(ok.body.inserted, 3); assert.equal(ok.body.state, 'draft');
  const ind = (await call('GET', `/indicators?project_id=${P1}`, entry)).body.find((i: any) => i.code === 'I1');
  const det = (await call('GET', `/indicators/${ind.id}`, entry)).body;
  assert.equal(det.values.length, 2); assert.ok(det.values.every((v: any) => v.workflow_state === 'draft'));             // l'import ne contourne pas la validation
  assert.ok(det.values.some((v: any) => v.value === 96.5 && v.dimensions.region === 'Nord'));

  const again = await call('POST', '/imports/indicator-values/commit', entry, { project_id: P1, format: 'csv', content: good });
  assert.equal(again.status, 422);                                                                                      // rejouer le même fichier : refusé, aucun écrasement
});

test('API : XLSX (nombres, dates, formules) ; format invalide ; droits ; isolation entre clients', async () => {
  const entry = await tok('de', T1, ['data_entry']);
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('v');
  ws.addRow(['indicator_code', 'period', 'period_end', 'kind', 'value']);
  ws.addRow(['I2', '2026-Q3', new Date(Date.UTC(2026, 8, 30)), 'actual', 12.5]);
  ws.addRow(['I2', '2026-Q4', '2026-12-31', 'actual', { formula: '5*2', result: 10 }]);
  const b64 = Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer).toString('base64');
  const r = await call('POST', '/imports/indicator-values/commit', entry, { project_id: P1, format: 'xlsx', content: b64 });
  assert.equal(r.status, 201); assert.equal(r.body.inserted, 2);
  assert.equal((await call('POST', '/imports/indicator-values/preview', entry, { project_id: P1, format: 'xlsx', content: Buffer.from('pas un xlsx').toString('base64') })).status, 400);
  assert.equal((await call('POST', '/imports/indicator-values/preview', entry, { project_id: P1, format: 'csv', content: 'a,b\n1,2' })).body.error, 'import_format');
  assert.equal((await call('POST', '/imports/indicator-values/preview', await tok('v', T1, ['viewer']), { project_id: P1, format: 'csv', content: CSV([]) })).status, 403);
  const other = await tok('o', T2, ['data_entry']);
  assert.equal((await call('POST', '/imports/indicator-values/preview', other, { project_id: P1, format: 'csv', content: CSV(['I1,2026-Q1,2026-03-31,actual,1,,']) })).status, 404);   // projet d'un autre client : inexistant
});
