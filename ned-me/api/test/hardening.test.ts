import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { makePool } from '../src/db.ts';
import { makeVerifier } from '../src/auth.ts';
import { buildApp } from '../src/app.ts';
import { memoryStorage } from '../src/storage.ts';
import { userLimit } from '../src/limits.ts';

const SECRET = 'test-secret-test-secret-test-secret';
const T1 = 'aaaaaaaa-0000-0000-0000-000000000001';
// Pool volontairement injoignable : ces tests prouvent que les protections jouent AVANT tout accès base de données.
const deadPool = () => makePool('postgres://nobody:secret-password@127.0.0.1:1/none');
const tok = (roles: string[] = ['admin']) => new SignJWT({ tenant_id: T1, roles }).setProtectedHeader({ alg: 'HS256' }).setSubject('u').setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
const build = (opts = {}) => buildApp(deadPool(), makeVerifier({ secret: SECRET }), memoryStorage(), opts);

test('en-têtes de sécurité et identifiant de requête (distinct par requête)', async () => {
  const app = build();
  const a = await app.inject({ url: '/health' }), b = await app.inject({ url: '/health' });
  assert.equal(a.headers['x-content-type-options'], 'nosniff');
  assert.ok(String(a.headers['strict-transport-security']).includes('max-age=31536000'));
  assert.equal(a.headers['x-frame-options'], 'SAMEORIGIN');
  assert.equal(a.headers['x-powered-by'], undefined);
  assert.match(String(a.headers['x-request-id']), /^[0-9a-f-]{36}$/);
  assert.notEqual(a.headers['x-request-id'], b.headers['x-request-id']);
  await app.close();
});

test('limitation de débit : 429 après le seuil, /health exclu, 401 comptés (anti brute-force)', async () => {
  const app = build({ rateLimitMax: 5 });
  const codes: number[] = [];
  for (let i = 0; i < 7; i++) codes.push((await app.inject({ url: '/projects', headers: { authorization: 'Bearer faux' } })).statusCode);
  assert.deepEqual(codes, [401, 401, 401, 401, 401, 429, 429]);
  const limited = await app.inject({ url: '/projects' });
  assert.equal(limited.statusCode, 429); assert.ok(limited.headers['retry-after']);
  for (let i = 0; i < 20; i++) assert.equal((await app.inject({ url: '/health' })).statusCode, 200);   // la supervision n'est jamais bloquée
  await app.close();
});

test('limiteur par utilisateur : fenêtre fixe, isolé par utilisateur et par tenant, repart après la fenêtre, purge', async () => {
  let t = 1_000_000;
  const lim = userLimit('op', 3, 60_000, () => t);
  const mk = (sub: string, tenantId = T1) => ({ principal: { sub, tenantId } });
  const reply = () => { const r: any = { h: {}, code: 0, header(k: string, v: unknown) { r.h[k] = v; return r; }, code_(c: number) { r.code = c; return r; } }; r.code = (c: number) => { r.status = c; return { send: (b: unknown) => { r.body = b; return r; } }; }; return r; };
  const hit = async (sub: string, tenantId?: string) => { const r = reply(); await lim(mk(sub, tenantId), r); return r.status ?? 200; };
  assert.deepEqual([await hit('a'), await hit('a'), await hit('a'), await hit('a')], [200, 200, 200, 429]);
  assert.equal(await hit('b'), 200);                                  // un autre utilisateur n'est pas affecté
  assert.equal(await hit('a', 'bbbbbbbb-0000-0000-0000-000000000002'), 200);   // ni le même sub dans un autre tenant
  const r = reply(); await lim(mk('a'), r); assert.ok(Number(r.h['retry-after']) >= 1 && Number(r.h['retry-after']) <= 60);
  t += 60_001;
  assert.equal(await hit('a'), 200);                                  // nouvelle fenêtre
});

test('limite stricte sur les routes coûteuses (génération de rapports), comptée par utilisateur', async () => {
  const app = build({ rateLimitMax: 1000 });
  const t = await tok(['viewer']);                 // 403 de rôle, mais chaque appel compte
  const codes: number[] = [];
  for (let i = 0; i < 22; i++) codes.push((await app.inject({ method: 'POST', url: '/reports', payload: {}, headers: { authorization: `Bearer ${t}` } })).statusCode);
  assert.equal(codes.filter((c) => c === 403).length, 20); assert.equal(codes.filter((c) => c === 429).length, 2);
  await app.close();
});

test('taille de corps : 413 avant tout traitement', async () => {
  const app = build({ bodyLimit: 1024 });
  const r = await app.inject({ method: 'POST', url: '/projects', payload: { x: 'a'.repeat(5000) }, headers: { authorization: `Bearer ${await tok()}`, 'content-type': 'application/json' } });
  assert.equal(r.statusCode, 413);
  await app.close();
});

test('une panne base ne divulgue rien (hôte, mot de passe, message pg) : 500 générique', async () => {
  const app = build();
  const r = await app.inject({ url: '/projects', headers: { authorization: `Bearer ${await tok(['viewer'])}` } });
  assert.equal(r.statusCode, 500);
  assert.deepEqual(JSON.parse(r.body), { error: 'internal' });
  assert.ok(!/secret-password|127\.0\.0\.1|ECONNREFUSED|nobody/.test(r.body));
  await app.close();
});

test('journaux : le jeton et le cookie n\'apparaissent jamais, même si un objet requête est journalisé explicitement', async () => {
  const lines: string[] = [];
  const app = build({ logStream: { write: (m: string) => void lines.push(m) } });
  const t = await tok(['viewer']);
  await app.inject({ url: '/projects', headers: { authorization: `Bearer ${t}`, cookie: 'session=abc123' } });
  app.log.info({ req: { headers: { authorization: `Bearer ${t}`, cookie: 'session=abc123', accept: 'json' } } }, 'journalisation explicite d\'en-têtes');
  await app.close();
  const log = lines.join('');
  assert.ok(log.includes('journalisation explicite'), 'des journaux sont produits');
  assert.ok(!log.includes(t) && !log.includes('abc123'), 'ni jeton ni cookie en clair');
  // Fastify sérialise `req` sans ses en-têtes ; le masquage configuré (redact) reste une seconde barrière si un en-tête était journalisé autrement.
});

test('erreurs client conservées : JSON invalide → 400, média non supporté → 415, jamais 500', async () => {
  const app = build();
  const h = { authorization: `Bearer ${await tok()}` };
  const bad = await app.inject({ method: 'POST', url: '/projects', payload: '{"x": ', headers: { ...h, 'content-type': 'application/json' } });
  assert.equal(bad.statusCode, 400); assert.ok(!/SyntaxError|Unexpected|position/.test(bad.body));
  const media = await app.inject({ method: 'POST', url: '/projects', payload: 'a=b', headers: { ...h, 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(media.statusCode, 415);
  await app.close();
});

test('jeton : algorithme, expiration, signature, tenant invalide', async () => {
  const app = build();
  const enc = new TextEncoder().encode(SECRET), bad = new TextEncoder().encode('un-autre-secret-un-autre-secret!!');
  const call = (t: string) => app.inject({ url: '/projects', headers: { authorization: `Bearer ${t}` } }).then((r) => r.statusCode);
  assert.equal(await call(await new SignJWT({ tenant_id: T1, roles: ['viewer'] }).setProtectedHeader({ alg: 'HS256' }).setSubject('u').setExpirationTime('-1h').sign(enc)), 401);   // expiré
  assert.equal(await call(await new SignJWT({ tenant_id: T1, roles: ['viewer'] }).setProtectedHeader({ alg: 'HS256' }).setSubject('u').setExpirationTime('1h').sign(bad)), 401);    // mauvaise signature
  assert.equal(await call(await new SignJWT({ tenant_id: 'pas-un-uuid', roles: ['viewer'] }).setProtectedHeader({ alg: 'HS256' }).setSubject('u').setExpirationTime('1h').sign(enc)), 401);
  assert.equal(await call(await new SignJWT({ tenant_id: T1, roles: ['viewer'] }).setProtectedHeader({ alg: 'HS512' }).setSubject('u').setExpirationTime('1h').sign(enc)), 401);       // algorithme non autorisé
  assert.equal(await call('eyJhbGciOiJub25lIn0.eyJ0ZW5hbnRfaWQiOiJ4In0.'), 401);                                                                                                       // alg=none
  await app.close();
});
