import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import pg from 'pg';
import { makePool, withTenant } from '../src/db.ts';
import { makeVerifier } from '../src/auth.ts';
import { buildApp } from '../src/app.ts';
import { memoryStorage } from '../src/storage.ts';
import { safeFilename } from '../src/evidence.ts';

const ADMIN = process.env.ADMIN_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const DB = 'ned_evi_test', SECRET = 'test-secret-test-secret-test-secret';
const T1 = 'aaaaaaaa-0000-0000-0000-000000000001', T2 = 'bbbbbbbb-0000-0000-0000-000000000002';
const dir = new URL('../../db/migrations/', import.meta.url);
const storage = memoryStorage();
let pool: pg.Pool, app: ReturnType<typeof buildApp>;
let projectId = '', indicatorId = '', valueId = '', outputId = '';
const SEED = { sub: 'seed', tenantId: T1, roles: [] as string[] };

const tok = (sub: string, tenant: string, roles: string[]) => new SignJWT({ tenant_id: tenant, roles }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
const call = async (method: string, url: string, token: string, payload?: unknown) => {
  const r = await app.inject({ method: method as 'GET', url, payload: payload as object, headers: { authorization: `Bearer ${token}` } });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
};

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN }); await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB}`); await admin.query(`CREATE DATABASE ${DB}`); await admin.end();
  const owner = new pg.Client({ connectionString: ADMIN.replace(/\/[^/]*$/, `/${DB}`) }); await owner.connect();
  for (const f of ['001_foundation', '002_results_indicators', '004_arabic_search', '005_workflow', '006_dqa', '007_evidence']) await owner.query(readFileSync(new URL(`${f}.sql`, dir), 'utf8'));
  await owner.query(`DROP ROLE IF EXISTS ned_evi_login; CREATE ROLE ned_evi_login LOGIN PASSWORD 'x' IN ROLE ned_app`);
  await owner.query(`INSERT INTO tenant (id,name) VALUES ('${T1}','A'),('${T2}','B')`);
  await owner.end();
  pool = makePool(ADMIN.replace(/\/\/[^@]*@/, '//ned_evi_login:x@').replace(/\/[^/]*$/, `/${DB}`));
  app = buildApp(pool, makeVerifier({ secret: SECRET }), storage);
  await withTenant(pool, SEED, async (c) => {
    const prog = (await c.query("INSERT INTO program (tenant_id,code,name) VALUES (app.current_tenant(),'P','{\"fr\":\"p\"}') RETURNING id")).rows[0].id;
    projectId = (await c.query("INSERT INTO project (tenant_id,program_id,code,name) VALUES (app.current_tenant(),$1,'J','{\"fr\":\"j\"}') RETURNING id", [prog])).rows[0].id;
    const res = async (level: string, code: string, parent: string | null) => (await c.query(
      "INSERT INTO result (tenant_id,project_id,level,code,name,parent_id) VALUES (app.current_tenant(),$1,$2,$3,'{\"fr\":\"r\"}',$4) RETURNING id", [projectId, level, code, parent])).rows[0].id;
    const imp = await res('impact', 'I1', null), oc = await res('outcome', 'O1', imp); outputId = await res('output', 'OP1', oc);
    indicatorId = (await c.query("INSERT INTO indicator (tenant_id,project_id,result_id,code,name) VALUES (app.current_tenant(),$1,$2,'IND1','{\"fr\":\"i\"}') RETURNING id", [projectId, outputId])).rows[0].id;
    valueId = (await c.query("INSERT INTO indicator_value (tenant_id,indicator_id,period,period_end,kind,value) VALUES (app.current_tenant(),$1,'Q1','2026-03-31','actual',50) RETURNING id", [indicatorId])).rows[0].id;
  });
});
after(async () => { await app.close(); await pool.end(); });

test('safeFilename : chemins, caractères spéciaux, arabe', () => {
  assert.equal(safeFilename('../../etc/passwd'), 'passwd');
  assert.equal(safeFilename('C:\\x\\rapport final.pdf'), 'rapport_final.pdf');
  assert.equal(safeFilename('.hidden'), 'hidden');
  assert.equal(safeFilename('تقرير المشروع.pdf'), 'تقرير_المشروع.pdf');
  assert.equal(safeFilename('///'), 'file');
  assert.ok(safeFilename('a'.repeat(300) + '.pdf').length <= 120);
});

let evId = '', key = '';
test('téléversement en deux temps : pending → fichier absent/taille fausse refusés → available', async () => {
  const entry = await tok('dana', T1, ['data_entry']);
  const body = { project_id: projectId, kind: 'photo', title: 'Photo du site', filename: '../photo 1.jpg', content_type: 'image/jpeg', size_bytes: 1000,
    latitude: 33.57, longitude: -7.58, link: { indicator_value_id: valueId } };
  const r = await call('POST', '/evidence', entry, body);
  assert.equal(r.status, 201); assert.equal(r.body.status, 'pending');
  evId = r.body.id; key = r.body.upload.url.replace('memory://put/', '');
  assert.equal(key, `${T1}/${evId}/photo_1.jpg`);                                 // clé serveur, préfixe tenant, nom assaini
  assert.equal((await call('POST', `/evidence/${evId}/complete`, entry)).status, 409);        // pas encore téléversé
  storage.put(key, { size: 999 });
  assert.equal((await call('POST', `/evidence/${evId}/complete`, entry)).status, 409);        // taille différente
  assert.equal((await call('GET', `/evidence/${evId}/download`, entry)).status, 409);        // inaccessible tant que pending
  storage.put(key, { size: 1000 });
  assert.equal((await call('POST', `/evidence/${evId}/complete`, await tok('eve', T1, ['data_entry']))).status, 403);   // pas l'auteur
  assert.equal((await call('POST', `/evidence/${evId}/complete`, entry)).body.status, 'available');
  assert.equal((await call('POST', `/evidence/${evId}/complete`, entry)).body.status, 'available');   // idempotent
  const dl = await call('GET', `/evidence/${evId}/download`, await tok('v', T1, ['viewer']));
  assert.ok(dl.body.url.startsWith(`memory://get/${key}`));
});

test('validations : type, taille, url, GPS, droits', async () => {
  const entry = await tok('dana', T1, ['data_entry']), viewer = await tok('v', T1, ['viewer']);
  const base = { project_id: projectId, kind: 'document', title: 't', filename: 'a.pdf', content_type: 'application/pdf', size_bytes: 10 };
  assert.equal((await call('POST', '/evidence', viewer, base)).status, 403);
  assert.equal((await call('POST', '/evidence', entry, { ...base, content_type: 'application/x-msdownload', filename: 'a.exe' })).status, 415);
  assert.equal((await call('POST', '/evidence', entry, { ...base, size_bytes: 26 * 1024 * 1024 })).status, 400);
  assert.equal((await call('POST', '/evidence', entry, { ...base, latitude: 33 })).status, 400);
  assert.equal((await call('POST', '/evidence', entry, { ...base, latitude: 120, longitude: 0 })).status, 400);
  assert.equal((await call('POST', '/evidence', entry, { ...base, kind: 'url' })).status, 400);       // url manquante
  assert.equal((await call('POST', '/evidence', entry, { ...base, url: 'https://x.org' })).status, 400);   // url sur un fichier
  assert.equal((await call('POST', '/evidence', entry, { project_id: projectId, kind: 'url', title: 'x', url: 'javascript:alert(1)' })).status, 400);
  assert.equal((await call('POST', '/evidence', entry, { ...base, link: { indicator_id: indicatorId, result_id: outputId } })).status, 400);   // une seule cible
});

test('preuve URL, liens multiples, doublon refusé, chaîne complète Preuve → … → Projet', async () => {
  const entry = await tok('dana', T1, ['data_entry']), viewer = await tok('v', T1, ['viewer']);
  const u = await call('POST', '/evidence', entry, { project_id: projectId, kind: 'url', title: 'Rapport en ligne', url: 'https://example.org/report', link: { indicator_id: indicatorId } });
  assert.equal(u.status, 201); assert.equal(u.body.status, 'available'); assert.equal(u.body.upload, null);
  assert.equal((await call('GET', `/evidence/${u.body.id}/download`, viewer)).body.url, 'https://example.org/report');
  assert.equal((await call('POST', `/evidence/${evId}/links`, entry, { indicator_value_id: valueId })).status, 409);   // doublon
  assert.equal((await call('POST', `/evidence/${evId}/links`, entry, { indicator_id: indicatorId })).status, 201);

  const cr = await call('GET', `/indicator-values/${valueId}/chain`, viewer); assert.equal(cr.status, 200); const chain = cr.body;
  assert.deepEqual(chain.results.map((r: any) => r.level), ['output', 'outcome', 'impact']);
  assert.equal(chain.indicator.code, 'IND1'); assert.equal(chain.project.code, 'J');
  assert.equal(chain.evidence.length, 2);   // photo (liée à la donnée ET à l'indicateur : une seule fois) + url
  assert.deepEqual(chain.evidence.map((e: any) => [e.kind, e.linked_at]), [['photo', 'value'], ['url', 'indicator']]);
  // isolation : un autre tenant ne voit rien
  const other = await tok('o', T2, ['me_manager']);
  assert.equal((await call('GET', `/indicator-values/${valueId}/chain`, other)).status, 404);
  assert.deepEqual((await call('GET', '/evidence', other)).body, []);
  assert.equal((await call('GET', `/evidence/${evId}/download`, other)).status, 404);
  assert.equal((await call('GET', `/evidence?indicator_value_id=${valueId}`, viewer)).body.length, 1);
});
