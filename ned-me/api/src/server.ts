import { makePool } from './db.ts';
import { makeVerifier } from './auth.ts';
import { buildApp } from './app.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL requis (rôle ned_api, NON superuser)');
const jwks = process.env.OIDC_JWKS_URL;
const secret = process.env.DEV_JWT_SECRET;
if (!jwks && !secret) throw new Error('OIDC_JWKS_URL (prod) ou DEV_JWT_SECRET (dev) requis');
const verify = makeVerifier(jwks ? { jwksUrl: jwks, issuer: process.env.OIDC_ISSUER } : { secret: secret! });
await buildApp(makePool(url), verify).listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' });
