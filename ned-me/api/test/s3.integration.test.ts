// Intégration avec un VRAI serveur S3 (SeaweedFS, MinIO, Garage…). Ignoré si S3_TEST_ENDPOINT n'est pas défini.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { s3Storage } from '../src/storage.ts';

const endpoint = process.env.S3_TEST_ENDPOINT;
const opts = { skip: !endpoint && 'S3_TEST_ENDPOINT non défini' };
const mk = (bucket: string) => s3Storage({ endpoint: endpoint!, bucket, accessKeyId: process.env.S3_TEST_ACCESS_KEY ?? 'nedtestkey', secretAccessKey: process.env.S3_TEST_SECRET_KEY ?? 'nedtestsecret123' });
const put = (url: string, headers: Record<string, string>, body: Buffer) => fetch(url, { method: 'PUT', headers, body: new Uint8Array(body) });

test('bucket créé au démarrage, idempotent', opts, async () => {
  const st = mk(`ned-it-${Date.now()}`);
  await st.ensureBucket!(); await st.ensureBucket!();             // deux appels : aucune erreur
});

test('téléversement présigné réel : accepté, taille différente refusée, objet vérifié, téléchargé à l\'identique', opts, async () => {
  const st = mk('ned-it-evidence'); await st.ensureBucket!();
  const body = Buffer.from(`preuve terrain ${randomUUID()} — دليل ميداني\n`, 'utf8');
  const key = `${randomUUID()}/${randomUUID()}/preuve.txt`;
  assert.equal(await st.head(key), null);                         // absent avant téléversement
  const p = await st.presignPut(key, { contentType: 'text/plain', size: body.length });
  const bigger = Buffer.concat([body, body]);
  const refused = await put(p.url, p.headers, bigger);
  assert.ok(refused.status >= 400 && refused.status < 500, `taille différente acceptée (HTTP ${refused.status})`);
  assert.equal(await st.head(key), null);                         // rien n'a été écrit
  const okRes = await put(p.url, p.headers, body);
  assert.equal(okRes.status, 200, await okRes.text());
  assert.equal((await st.head(key))!.size, body.length);
  const dl = await fetch(await st.presignGet(key, 'تقرير.txt'));
  assert.equal(dl.status, 200);
  assert.deepEqual(Buffer.from(await dl.arrayBuffer()), body);
});

test('somme SHA-256 : contenu conforme accepté, contenu altéré de même taille refusé', opts, async () => {
  const st = mk('ned-it-evidence');
  const body = Buffer.from('contenu exact 0123456789');
  const sha = createHash('sha256').update(body).digest('hex');
  const key = `${randomUUID()}/sha.txt`;
  const p = await st.presignPut(key, { contentType: 'text/plain', size: body.length, sha256Hex: sha });
  const tampered = Buffer.from(body); tampered[0] ^= 1;            // même taille, un bit changé
  const bad = await put(p.url, p.headers, tampered);
  assert.ok(bad.status >= 400, `contenu altéré accepté (HTTP ${bad.status})`);
  assert.equal(await st.head(key), null);
  const good = await put(p.url, p.headers, body);
  assert.equal(good.status, 200, await good.text());
});
