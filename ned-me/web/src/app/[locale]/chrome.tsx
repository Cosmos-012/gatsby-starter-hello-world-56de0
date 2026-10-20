import Link from 'next/link';
import { LOCALES, messagesFor, translate, type Locale } from '@/lib/i18n';
import { oidcConfig, readSession } from '@/lib/session';

/** Barre supérieure commune : marque, navigation entre pages, langue, connexion. */
export async function Header({ locale, keep, section }: { locale: Locale; keep: string; section: 'overview' | 'settings' }) {
  const m = messagesFor(locale);
  const t = (k: string, p?: Record<string, string | number>) => translate(m, k, p);
  const session = await readSession();
  const oidc = !!oidcConfig();
  const path = section === 'settings' ? '/settings' : '';
  const q = keep ? `?${keep}` : '';
  const nav = [{ id: 'overview' as const, href: `/${locale}${q}`, label: t('nav.overview') }, { id: 'settings' as const, href: `/${locale}/settings${q}`, label: t('nav.settings') }];
  return (
    <header className="topbar">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="brand-mark" aria-hidden="true">N</span>
          <p className="text-sm font-semibold">{t('app.title')}</p>
        </div>
        <nav aria-label={t('nav.overview')} className="flex gap-2 text-sm" data-testid="main-nav">
          {nav.map((n) => <Link key={n.id} href={n.href} aria-current={n.id === section ? 'page' : undefined} className={`nav-link ${n.id === section ? 'nav-active' : ''}`}>{n.label}</Link>)}
        </nav>
        <nav aria-label={t('lang.switch')} className="flex gap-3 text-sm">
          {LOCALES.map((l) => (
            <Link key={l} href={`/${l}${path}${q}`} hrefLang={l} lang={l} aria-current={l === locale ? 'page' : undefined}
              className={l === locale ? 'font-semibold underline underline-offset-4' : 'secondary hover:underline'}>{t(`lang.${l}`)}</Link>
          ))}
        </nav>
        {oidc && (
          <div className="flex items-center gap-3 text-sm" data-testid="auth">
            {session ? (
              <form method="post" action="/sso/logout" className="flex items-center gap-3">
                <input type="hidden" name="return" value={`/${locale}`} />
                {session.name && <span className="secondary" data-testid="auth-user">{t('auth.user', { name: session.name })}</span>}
                <button type="submit" className="underline underline-offset-4">{t('auth.logout')}</button>
              </form>
            ) : (
              <a href={`/sso/login?return=${encodeURIComponent(`/${locale}`)}`} className="underline underline-offset-4" data-testid="auth-login">{t('auth.login')}</a>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
