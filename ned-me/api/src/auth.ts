import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export interface Principal { sub: string; tenantId: string; roles: string[]; }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type KeySource = { jwksUrl: string; issuer?: string } | { secret: string; issuer?: string };

/** Vérifie un jeton OIDC (Keycloak en prod via JWKS ; secret HS256 réservé dev/test). */
export function makeVerifier(src: KeySource) {
  const key: JWTVerifyGetKey | Uint8Array = 'jwksUrl' in src
    ? createRemoteJWKSet(new URL(src.jwksUrl))
    : new TextEncoder().encode(src.secret);
  return async (token: string): Promise<Principal> => {
    const { payload } = await jwtVerify(token, key as never, {
      issuer: src.issuer,
      algorithms: 'jwksUrl' in src ? ['RS256', 'ES256'] : ['HS256'],
    });
    const tenantId = payload['tenant_id'];
    if (typeof payload.sub !== 'string' || typeof tenantId !== 'string' || !UUID.test(tenantId)) {
      throw new Error('token missing sub/tenant_id');
    }
    const realm = (payload['realm_access'] as { roles?: string[] } | undefined)?.roles;
    const roles = Array.isArray(payload['roles']) ? (payload['roles'] as string[]) : realm ?? [];
    return { sub: payload.sub, tenantId, roles };
  };
}
