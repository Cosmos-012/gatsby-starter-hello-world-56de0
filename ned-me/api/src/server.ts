import { makePool } from './db.ts';
import { makeVerifier } from './auth.ts';
import { buildApp } from './app.ts';
import { memoryStorage, s3Storage } from './storage.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL requis (rôle ned_api, NON superuser)');
const jwks = process.env.OIDC_JWKS_URL;
const secret = process.env.DEV_JWT_SECRET;
if (!jwks && !secret) throw new Error('OIDC_JWKS_URL (prod) ou DEV_JWT_SECRET (dev) requis');
const verify = makeVerifier(jwks ? { jwksUrl: jwks, issuer: process.env.OIDC_ISSUER } : { secret: secret! });
const s3 = process.env.S3_ENDPOINT;
// Le stockage mémoire perd les pièces à chaque redémarrage : réservé au développement ou à un test explicitement déclaré (NED_ALLOW_MEMORY_STORAGE=1).
if (!s3 && !secret && process.env.NED_ALLOW_MEMORY_STORAGE !== '1') throw new Error('S3_ENDPOINT requis en production (le stockage mémoire est réservé au développement)');
if (s3 && (!process.env.S3_ACCESS_KEY || !process.env.S3_SECRET_KEY)) throw new Error('S3_ACCESS_KEY et S3_SECRET_KEY requis');
const storage = s3
  ? s3Storage({ endpoint: s3, publicEndpoint: process.env.S3_PUBLIC_ENDPOINT || undefined, bucket: process.env.S3_BUCKET ?? 'ned-evidence', accessKeyId: process.env.S3_ACCESS_KEY!, secretAccessKey: process.env.S3_SECRET_KEY! })
  : memoryStorage();
// Le stockage peut démarrer après l'API : on réessaie la création du bucket avant d'accepter du trafic.
if (storage.ensureBucket) {
  for (let i = 1; ; i++) {
    try { await storage.ensureBucket(); break; }
    catch (e) { if (i >= 30) throw e; console.warn(`stockage S3 indisponible (tentative ${i}/30)`); await new Promise((r) => setTimeout(r, 2000)); }
  }
}
await buildApp(makePool(url), verify, storage, { logger: true, trustProxy: process.env.TRUST_PROXY === '1', rateLimitMax: process.env.RATE_LIMIT_MAX ? Number(process.env.RATE_LIMIT_MAX) : undefined }).listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' });
