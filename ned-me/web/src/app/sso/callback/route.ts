import { NextResponse, type NextRequest } from 'next/server';
import { endpoints, oidcConfig, takeTx, verifyIdToken, writeSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

const fail = (c: { publicUrl: string }, code: string) => NextResponse.redirect(`${c.publicUrl}/fr?auth_error=${code}`);

export async function GET(req: NextRequest) {
  const c = oidcConfig();
  if (!c) return new NextResponse('OIDC non configuré', { status: 404 });
  const tx = await takeTx<{ verifier: string; state: string; nonce: string; ret: string }>(c);   // à usage unique, même en cas d'échec
  const q = req.nextUrl.searchParams;
  if (!tx || q.get('state') !== tx.state) return fail(c, 'state');
  if (q.get('error') || !q.get('code')) return fail(c, 'denied');
  try {
    const e = await endpoints(c);
    const body = new URLSearchParams({ grant_type: 'authorization_code', code: q.get('code')!, redirect_uri: `${c.publicUrl}/sso/callback`, client_id: c.clientId, code_verifier: tx.verifier });
    const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
    if (c.clientSecret) headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(c.clientId)}:${encodeURIComponent(c.clientSecret)}`).toString('base64')}`;
    const r = await fetch(e.token_endpoint, { method: 'POST', headers, body, cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return fail(c, 'token');
    const t = (await r.json()) as { access_token: string; id_token: string; expires_in: number };
    const id = await verifyIdToken(c, t.id_token, tx.nonce);
    await writeSession(c, { at: t.access_token, exp: Math.floor(Date.now() / 1000) + Math.min(t.expires_in, 3600), idt: t.id_token,
      name: typeof id.name === 'string' ? id.name : typeof id.preferred_username === 'string' ? id.preferred_username : undefined });
    return NextResponse.redirect(`${c.publicUrl}${tx.ret}`);
  } catch {
    return fail(c, 'token');
  }
}
