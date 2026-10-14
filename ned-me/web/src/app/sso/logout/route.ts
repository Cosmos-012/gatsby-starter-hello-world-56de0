import { NextResponse, type NextRequest } from 'next/server';
import { dropSession, endpoints, oidcConfig, readSession, safeReturn } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** POST uniquement : une simple image ou un lien sur un autre site ne doit pas pouvoir déconnecter l'utilisateur. */
export async function POST(req: NextRequest) {
  const c = oidcConfig();
  if (!c) return new NextResponse('OIDC non configuré', { status: 404 });
  if (req.headers.get('origin') !== new URL(c.publicUrl).origin) return new NextResponse('origine refusée', { status: 403 });   // anti-CSRF : un autre site ne peut pas déconnecter
  const s = await readSession();
  await dropSession();
  const ret = safeReturn((await req.formData()).get('return') as string | null);
  const target = new URL(`${c.publicUrl}${ret}`);
  try {
    const e = await endpoints(c);
    if (e.end_session_endpoint) {
      const u = new URL(e.end_session_endpoint);
      u.searchParams.set('post_logout_redirect_uri', target.toString());
      u.searchParams.set('client_id', c.clientId);
      if (s?.idt) u.searchParams.set('id_token_hint', s.idt);
      return NextResponse.redirect(u, 303);
    }
  } catch { /* IdP injoignable : la session locale est tout de même supprimée */ }
  return NextResponse.redirect(target, 303);
}
