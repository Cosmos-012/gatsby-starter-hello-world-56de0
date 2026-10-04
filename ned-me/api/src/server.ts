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
if (!s3 && !secret) throw new Error('S3_ENDPOINT requis en production (le stockage mémoire est réservé au développement)');
if (s3 && (!process.env.S3_ACCESS_KEY || !process.env.S3_SECRET_KEY)) throw new Error('S3_ACCESS_KEY et S3_SECRET_KEY requis');
const storage = s3
  ? s3Storage({ endpoint: s3, bucket: process.env.S3_BUCKET ?? 'ned-evidence', accessKeyId: process.env.S3_ACCESS_KEY!, secretAccessKey: process.env.S3_SECRET_KEY! })
  : memoryStorage();
await buildApp(makePool(url), verify, storage).listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' });
