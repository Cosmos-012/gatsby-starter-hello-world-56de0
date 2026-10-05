import 'server-only';

export type ApiResult<T> = { ok: true; data: T } | { ok: false; reason: 'auth' | 'forbidden' | 'invalid' | 'api' };

/**
 * Appel serveur à l'API NED. Le jeton n'est JAMAIS envoyé au navigateur.
 * Développement : NED_DEV_TOKEN (jeton de service). Production : session OIDC (Keycloak) — pas encore branchée.
 */
export async function apiGet<T>(path: string): Promise<ApiResult<T>> {
  const base = process.env.NED_API_URL ?? 'http://localhost:3000';
  const token = process.env.NED_DEV_TOKEN;
  if (!token) return { ok: false, reason: 'auth' };
  try {
    const r = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (r.status === 401) return { ok: false, reason: 'auth' };
    if (r.status === 403) return { ok: false, reason: 'forbidden' };
    if (r.status === 400) return { ok: false, reason: 'invalid' };     // distinct d'une panne : ne pas annoncer « service indisponible »
    if (!r.ok) return { ok: false, reason: 'api' };
    return { ok: true, data: (await r.json()) as T };
  } catch {
    return { ok: false, reason: 'api' };
  }
}

export const isDevToken = () => !!process.env.NED_DEV_TOKEN;
