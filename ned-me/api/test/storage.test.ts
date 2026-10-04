import { test } from 'node:test';
import assert from 'node:assert/strict';
import { s3Storage } from '../src/storage.ts';

const base = { endpoint: 'http://minio:9000', bucket: 'ned-evidence', accessKeyId: 'AKIATEST', secretAccessKey: 'secret-test-key' };
const HEX = 'a'.repeat(64);

test('URL présignées : adresse publique, expiration, clé, signature ; l\'adresse interne ne fuit pas', async () => {
  const st = s3Storage({ ...base, publicEndpoint: 'https://files.example.org' });
  const key = '11111111-0000-0000-0000-000000000001/22222222-0000-0000-0000-000000000002/photo.jpg';
  const put = await st.presignPut(key, { contentType: 'image/jpeg', size: 1234 });
  const u = new URL(put.url);
  assert.equal(u.origin, 'https://files.example.org');
  assert.equal(u.pathname, `/ned-evidence/${key}`);                       // chemin = bucket/clé, sans préfixe réécrit
  assert.equal(u.searchParams.get('X-Amz-Expires'), '300');
  assert.ok(u.searchParams.get('X-Amz-Signature')!.length === 64);
  assert.ok(!put.url.includes('minio:9000'));
  const get = new URL(await st.presignGet(key, 'تقرير النشاط.pdf'));
  assert.equal(get.origin, 'https://files.example.org');
  assert.ok(get.searchParams.get('response-content-disposition')!.includes(encodeURIComponent('تقرير النشاط.pdf')));   // nom arabe encodé (RFC 5987)
});

test('la taille et le type déclarés sont SIGNÉS : un client ne peut pas téléverser autre chose', async () => {
  const st = s3Storage({ ...base });
  const put = await st.presignPut('t/e/f.pdf', { contentType: 'application/pdf', size: 500 });
  const signed = new URL(put.url).searchParams.get('X-Amz-SignedHeaders')!.split(';');
  assert.ok(signed.includes('content-type') && signed.includes('content-length') && signed.includes('host'), signed.join(';'));
  assert.equal(put.headers['content-type'], 'application/pdf');
  // deux tailles différentes => signatures différentes
  const other = await st.presignPut('t/e/f.pdf', { contentType: 'application/pdf', size: 501 });
  assert.notEqual(new URL(put.url).searchParams.get('X-Amz-Signature'), new URL(other.url).searchParams.get('X-Amz-Signature'));
});

test('somme de contrôle SHA-256 transmise en base64 et exigée du client', async () => {
  const st = s3Storage({ ...base });
  const put = await st.presignPut('t/e/f.pdf', { contentType: 'application/pdf', size: 10, sha256Hex: HEX });
  assert.equal(put.headers['x-amz-checksum-sha256'], Buffer.from(HEX, 'hex').toString('base64'));
  const none = await st.presignPut('t/e/f.pdf', { contentType: 'application/pdf', size: 10 });
  assert.equal(none.headers['x-amz-checksum-sha256'], undefined);
});

test('sans adresse publique : repli sur l\'adresse interne (développement local)', async () => {
  const st = s3Storage({ ...base });
  assert.equal(new URL((await st.presignPut('k', { contentType: 'text/csv', size: 1 })).url).origin, 'http://minio:9000');
});
