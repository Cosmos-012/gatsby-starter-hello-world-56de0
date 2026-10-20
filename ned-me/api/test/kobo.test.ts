import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import { SignJWT } from 'jose';
import { allMigrations } from './migrations.ts';
import { makePool } from '../src/db.ts';
import { makeVerifier } from '../src/auth.ts';
import { buildApp } from '../src/app.ts';
import { koboConfig, makeKoboConnector } from '../src/connectors/kobo.ts';
import { registerConnector, getConnector } from '../src/connectors/index.ts';
import { nest } from '../src/integrations.ts';

const ADMIN = process.env.ADMIN_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const DB = 'ned_kobo_test', SECRET = 'test-secret-test-secret-test-secret';
const T1 = 'aaaaaaaa-0000-0000-0000-000000000001', T2 = 'bbbbbbbb-0000-0000-0000-000000000002';
const TOKEN = 'secret-token-0123456789', UID = 'aAbBcCdDeEfFgG12';
let pool: pg.Pool, app: ReturnType<typeof buildApp>, P1: string, srv: http.Server, base: string, hits: { url: string; auth?: string }[] = [], mode: 'ok' | 'redirect' | 'json' | 'other-host' | '500' | '401' = 'ok';

// start = rang absolu de la première soumission (0-based) ; _id = rang + 1
const SUBS = (start: number, n: number) => Array.from({ length: n }, (_, k) => { const i = start + k; return { _id: i + 1, _submission_time: i % 2 ? '2026-04-02T10:00:00' : '2026-01-02T10:00:00', 'grp/code': 'I1', per: `2026-Q${i + 1}`, fin: `2026-0${3 * (i + 1)}-28T00:00:00`, val: `${10 + i},5`, 'grp/region': i % 2 ? 'Nord' : 'Sud' }; });
const tok = (sub: string, tenant: string, roles: string[]) => new SignJWT({ tenant_id: tenant, roles }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
const call = async (method: string, url: string, token: string, payload?: unknown) => {
  const r = await app.inject({ method: method as 'GET', url, payload: payload as object, headers: { authorization: `Bearer ${token}` } });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
};
const VALUES = (extra: Record<string, string> = {}) => ({ server: base, assetUid: UID, token: TOKEN, 'mapping.indicator_code': 'grp/code', 'mapping.period': 'per', 'mapping.period_end': 'fin', 'mapping.value': 'val', 'mapping.kind': 'actual', dims: 'region=grp/region', ...extra });

before(async () => {
  srv = http.createServer((req, res) => {
    hits.push({ url: req.url ?? '', auth: req.headers.authorization });
    const u = new URL(req.url ?? '', base);
    if (mode === '401') { res.writeHead(401); return res.end(); }
    if (mode === '500') { res.writeHead(500); return res.end(); }
    if (mode === 'redirect') { res.writeHead(302, { location: `${base}/elsewhere` }); return res.end(); }
    if (mode === 'json') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('<html>pas du json'); }
    res.writeHead(200, { 'content-type': 'application/json' });
    const page = u.searchParams.get('page');
    if (!page) return res.end(JSON.stringify({ count: 3, next: mode === 'other-host' ? 'http://evil.example/x' : `${base}/api/v2/assets/${UID}/data/?format=json&limit=500&page=2`, results: SUBS(0, 2) }));
    return res.end(JSON.stringify({ count: 3, next: null, results: SUBS(2, 1) }));
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const host = new URL(base).host;
  // Les tests autorisent explicitement l'hôte local en http ; la configuration par défaut ne l'autorise jamais.
  if (!getConnector('kobo')) registerConnector(makeKoboConnector({ allowedHosts: [host], insecureHosts: [host] }));
  const admin = new pg.Client({ connectionString: ADMIN }); await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB}`); await admin.query(`CREATE DATABASE ${DB}`); await admin.end();
  const owner = new pg.Client({ connectionString: ADMIN.replace(/\/[^/]*$/, `/${DB}`) }); await owner.connect();
  for (const sql of allMigrations()) await owner.query(sql);
  await owner.query(`DROP ROLE IF EXISTS ned_kobo_login; CREATE ROLE ned_kobo_login LOGIN PASSWORD 'x' IN ROLE ned_app`);
  await owner.query(`INSERT INTO tenant (id,name) VALUES ('${T1}','A'),('${T2}','B')`); await owner.end();
  pool = makePool(ADMIN.replace(/\/\/[^@]*@/, '//ned_kobo_login:x@').replace(/\/[^/]*$/, `/${DB}`));
  app = buildApp(pool, makeVerifier({ secret: SECRET }));
  const m = await tok('m', T1, ['me_manager']);
  const g = (await call('POST', '/programs', m, { code: 'G', name: { fr: 'P' } })).body.id;
  P1 = (await call('POST', '/projects', m, { program_id: g, code: 'P1', name: { fr: 'Un' } })).body.id;
  await call('POST', '/indicators', m, { project_id: P1, code: 'I1', name: { fr: 'I1' } });
});
after(async () => { await app.close(); await pool.end(); srv.close(); });

test('configuration : champs obligatoires, ventilations lisibles, noms inconnus et dangereux refusés', () => {
  assert.equal(koboConfig.safeParse({}).success, false);
  const ok = koboConfig.safeParse({ server: 'https://kf.kobotoolbox.org', assetUid: UID, token: TOKEN, mapping: { indicator_code: 'c', period: 'p', period_end: 'e', value: 'v' }, dims: 'region=g/r ; sexe=s' });
  assert.ok(ok.success); assert.deepEqual((ok as any).data.dims, { region: 'g/r', sexe: 's' }); assert.equal((ok as any).data.mapping.kind, 'actual');
  assert.equal(koboConfig.safeParse({ server: 'https://x.org', assetUid: 'court', token: TOKEN, mapping: { indicator_code: 'c', period: 'p', period_end: 'e', value: 'v' } }).success, false);
  assert.equal(koboConfig.safeParse({ server: 'https://x.org', assetUid: UID, token: TOKEN, mapping: { indicator_code: 'c', period: 'p', period_end: 'e', value: 'v' }, dims: 'Bad Name=x' }).success, false);
  assert.deepEqual(nest({ 'mapping.value': ' v ', token: '', server: 'https://x' }, new Set(['mapping.value', 'token', 'server'])), { mapping: { value: 'v' }, server: 'https://x' });
  assert.throws(() => nest({ inconnu: 'x' }, new Set(['server'])), /champ inconnu/);
  assert.throws(() => nest({ '__proto__.x': '1' }, new Set(['__proto__.x'])), /interdit/);
});

test('exécution : pagination, jeton envoyé, correspondance, virgule décimale, ventilation, brouillons, traçabilité de la source', async () => {
  hits = []; mode = 'ok';
  const e = await tok('de', T1, ['data_entry']);
  const r = await call('POST', '/integrations/kobo/run', e, { project_id: P1, values: VALUES() });
  assert.equal(r.status, 201); assert.equal(r.body.inserted, 3); assert.equal(hits.length, 2);                                  // deux pages
  assert.ok(hits.every((h) => h.auth === `Token ${TOKEN}`));
  const ind = (await call('GET', `/indicators?project_id=${P1}`, e)).body[0];
  const det = (await call('GET', `/indicators/${ind.id}`, e)).body;
  assert.equal(det.values.length, 3); assert.ok(det.values.every((v: any) => v.workflow_state === 'draft'));
  const q1 = det.values.find((v: any) => v.period === '2026-Q1');
  assert.equal(q1.value, 10.5); assert.deepEqual(q1.dimensions, { region: 'Sud' }); assert.equal(q1.period_end, '2026-03-28'); assert.match(q1.comment, /^kobo:1/);
  // le jeton n'apparaît dans aucune réponse
  assert.ok(!JSON.stringify(r.body).includes(TOKEN));
});

test('rejouer : refusé par défaut (aucun écrasement), ignoré si demandé, jamais écrasé', async () => {
  mode = 'ok';
  const e = await tok('de', T1, ['data_entry']);
  const again = await call('POST', '/integrations/kobo/run', e, { project_id: P1, values: VALUES() });
  assert.equal(again.status, 422); assert.equal(again.body.status, 'has_errors');
  const skip = await call('POST', '/integrations/kobo/run', e, { project_id: P1, values: VALUES(), skip_existing: true });
  assert.equal(skip.status, 201); assert.equal(skip.body.inserted, 0); assert.equal(skip.body.skipped, 3);
});

test('filtre « depuis le » : seules les soumissions récentes sont lues (ici une seule, déjà importée → ignorée)', async () => {
  mode = 'ok';
  const m = await tok('m', T1, ['me_manager']);
  const r = await call('POST', '/integrations/kobo/run', m, { project_id: P1, values: VALUES({ since: '2026-03-01' }), skip_existing: true });
  assert.equal(r.status, 201); assert.equal(r.body.inserted, 0); assert.equal(r.body.skipped, 1);
  const none = await call('POST', '/integrations/kobo/run', m, { project_id: P1, values: VALUES({ since: '2027-01-01' }) });
  assert.equal(none.status, 201); assert.equal(none.body.inserted, 0);                                                    // rien de nouveau : réussite à vide, pas une erreur
});

test('erreurs de la source : jeton refusé, 500, JSON illisible, redirection, pagination vers un autre hôte', async () => {
  const e = await tok('de', T1, ['data_entry']);
  const run = async (m: typeof mode, v: Record<string, string> = {}) => { mode = m; return call('POST', '/integrations/kobo/run', e, { project_id: P1, values: VALUES(v), skip_existing: true }); };
  const a = await run('401'); assert.equal(a.status, 400); assert.match(a.body.message, /jeton/);
  assert.ok(!JSON.stringify(a.body).includes(TOKEN));
  assert.match((await run('500')).body.message, /500/);
  assert.match((await run('json')).body.message, /illisible/);
  assert.equal((await run('redirect')).body.reason, 'pull_failed');                                                    // redirection non suivie
  assert.match((await run('other-host')).body.message, /autre hôte|non autorisé/);
});

test('hôte non autorisé et configuration incomplète : refus avant tout appel réseau', async () => {
  hits = []; mode = 'ok';
  const e = await tok('de', T1, ['data_entry']);
  const bad = await call('POST', '/integrations/kobo/run', e, { project_id: P1, values: VALUES({ server: 'http://127.0.0.1:1' }) });
  assert.equal(bad.status, 400); assert.match(bad.body.message, /non autorisé/); assert.equal(hits.length, 0);
  const strict = makeKoboConnector({ allowedHosts: [new URL(base).host] });                                           // sans insecureHosts : http refusé
  await assert.rejects(strict.pull(koboConfig.parse({ server: base, assetUid: UID, token: TOKEN, mapping: { indicator_code: 'c', period: 'p', period_end: 'e', value: 'v' } }), { projectId: P1, signal: new AbortController().signal }), /HTTPS obligatoire/);
  assert.equal((await call('POST', '/integrations/kobo/run', e, { project_id: P1, values: { server: base } })).body.reason, 'invalid_config');
  assert.equal((await call('POST', '/integrations/kobo/run', e, { project_id: P1, values: { inconnu: 'x' } })).status, 400);
});

test('droits et isolation : lecteur refusé, autre client ne voit pas le projet, liste publique du formulaire', async () => {
  const v = await tok('v', T1, ['viewer']), o = await tok('o', T2, ['data_entry']);
  assert.equal((await call('POST', '/integrations/kobo/run', v, { project_id: P1, values: VALUES() })).status, 403);
  assert.equal((await call('POST', '/integrations/kobo/run', o, { project_id: P1, values: VALUES() })).status, 404);
  assert.equal((await call('POST', '/integrations/absent/run', o, { project_id: P1, values: {} })).status, 404);
  const list = (await call('GET', '/integrations', v)).body;
  assert.equal(list[0].id, 'kobo'); assert.ok(list[0].form.some((f: any) => f.name === 'token' && f.type === 'password'));
});
