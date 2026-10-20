import { NextResponse, type NextRequest } from 'next/server';
import { endpoints, oidcConfig, pkce, safeReturn, setTx } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const c = oidcConfig();
  if (!c) return new NextResponse('OIDC non configuré', { status: 404 });
  const p = pkce();
  const ret = safeReturn(req.nextUrl.searchParams.get('return'));
  await setTx(c, { verifier: p.verifier, state: p.state, nonce: p.nonce, ret });
  const e = await endpoints(c);
  const u = new URL(e.authorization_endpoint);
  u.search = new URLSearchParams({ client_id: c.clientId, response_type: 'code', scope: 'openid profile', redirect_uri: `${c.publicUrl}/sso/callback`,
    state: p.state, nonce: p.nonce, code_challenge: p.challenge, code_challenge_method: 'S256' }).toString();
  return NextResponse.redirect(u);
}
