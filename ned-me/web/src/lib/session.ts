import 'server-only';
import { cookies } from 'next/headers';
import { createRemoteJWKSet, EncryptJWT, jwtDecrypt, jwtVerify } from 'jose';
import { createHash, randomBytes } from 'node:crypto';

/**
 * Connexion OIDC (Keycloak) : code d'autorisation + PKCE, côté serveur uniquement.
 * Le jeton d'accès vit dans un cookie httpOnly CHIFFRÉ (A256GCM) : le navigateur ne peut pas le lire,
 * ni un script injecté. Il est envoyé à l'API par le serveur web, jamais au client.
 */
export interface Session { at: string; exp: number; idt?: string; name?: string }
export interface OidcConfig { issuer: string; clientId: string; clientSecret?: string; publicUrl: string; secret: Uint8Array }

export const oidcConfig = (): OidcConfig | null => {
  const issuer = process.env.OIDC_ISSUER, clientId = process.env.OIDC_CLIENT_ID, publicUrl = process.env.PUBLIC_URL, s = process.env.SESSION_SECRET;
  if (!issuer || !clientId || !publicUrl) return null;                       // connexion non configurée (dev avec jeton de service)
  if (!s || s.length < 32) throw new Error('SESSION_SECRET (32 caractères minimum) requis quand OIDC est configuré');
  return { issuer: issuer.replace(/\/$/, ''), clientId, clientSecret: process.env.OIDC_CLIENT_SECRET || undefined, publicUrl: publicUrl.replace(/\/$/, ''),
    secret: createHash('sha256').update(s).digest() };
};

const SESSION = 'ned_s', TX = 'ned_tx', CHUNK = 3500;
const secure = (c: OidcConfig) => c.publicUrl.startsWith('https://');
const base = (c: OidcConfig, maxAge: number) => ({ httpOnly: true, sameSite: 'lax' as const, secure: secure(c), path: '/', maxAge });

export const seal = (c: OidcConfig, data: Record<string, unknown>, ttlSeconds: number) =>
  new EncryptJWT(data).setProtectedHeader({ alg: 'dir', enc: 'A256GCM' }).setExpirationTime(`${ttlSeconds}s`).encrypt(c.secret);
export const unseal = async <T>(c: OidcConfig, jwe: string): Promise<T | null> => {
  try { return (await jwtDecrypt(jwe, c.secret)).payload as T; } catch { return null; }
};

let discovery: { at: number; doc: Record<string, string> } | undefined;
export async function endpoints(c: OidcConfig) {
  if (!discovery || Date.now() - discovery.at > 600_000) {
    const r = await fetch(`${c.issuer}/.well-known/openid-configuration`, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`discovery ${r.status}`);
    const doc = (await r.json()) as Record<string, string>;
    if (doc.issuer !== c.issuer) throw new Error('issuer de découverte différent de OIDC_ISSUER');
    discovery = { at: Date.now(), doc };
  }
  return discovery.doc;
}
const jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export const verifyIdToken = async (c: OidcConfig, idToken: string, nonce: string) => {
  const e = await endpoints(c);
  if (!jwks.has(e.jwks_uri)) jwks.set(e.jwks_uri, createRemoteJWKSet(new URL(e.jwks_uri), { timeoutDuration: 5000 }));
  const { payload } = await jwtVerify(idToken, jwks.get(e.jwks_uri)!, { issuer: c.issuer, audience: c.clientId, algorithms: ['RS256', 'ES256'] });
  if (payload.nonce !== nonce) throw new Error('nonce');
  return payload;
};

export const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url'), state: randomBytes(16).toString('base64url'), nonce: randomBytes(16).toString('base64url') };
};

/** Seuls les chemins relatifs du site sont acceptés comme retour (pas de redirection ouverte). */
export const safeReturn = (v: string | null | undefined) => (v && /^\/[a-z]{2}(\/|\?|$)/.test(v) && !v.startsWith('//') ? v : '/fr');

// ---- cookies (valeur découpée : un jeton Keycloak chiffré dépasse 4 Ko) ----
export async function writeSession(c: OidcConfig, s: Session) {
  const jar = await cookies();
  const value = await seal(c, { ...s }, Math.max(60, Math.floor(s.exp - Date.now() / 1000)));
  clearSession(jar);
  const n = Math.ceil(value.length / CHUNK);
  const maxAge = Math.max(60, Math.floor(s.exp - Date.now() / 1000));
  jar.set(`${SESSION}_n`, String(n), base(c, maxAge));
  for (let i = 0; i < n; i++) jar.set(`${SESSION}${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK), base(c, maxAge));
}
function clearSession(jar: Awaited<ReturnType<typeof cookies>>) {
  for (const k of jar.getAll().map((x) => x.name)) if (k === `${SESSION}_n` || /^ned_s\d+$/.test(k)) jar.delete(k);
}
export async function dropSession() { clearSession(await cookies()); }

export async function readSession(): Promise<Session | null> {
  const c = oidcConfig(); if (!c) return null;
  const jar = await cookies();
  const n = Number(jar.get(`${SESSION}_n`)?.value);
  if (!Number.isInteger(n) || n < 1 || n > 8) return null;
  let value = '';
  for (let i = 0; i < n; i++) { const p = jar.get(`${SESSION}${i}`)?.value; if (!p) return null; value += p; }
  const s = await unseal<Session>(c, value);
  return s && typeof s.at === 'string' && s.exp > Date.now() / 1000 ? s : null;
}

export const setTx = async (c: OidcConfig, tx: Record<string, string>) => (await cookies()).set(TX, await seal(c, tx, 600), base(c, 600));
export async function takeTx<T>(c: OidcConfig): Promise<T | null> {
  const jar = await cookies(); const v = jar.get(TX)?.value; jar.delete(TX);
  return v ? unseal<T>(c, v) : null;
}
