import Link from 'next/link';
import type { ReactNode } from 'react';
import { LayoutDashboard, Target, Upload, Plug, Settings2, LogOut, LogIn, User } from 'lucide-react';
import { LOCALES, messagesFor, translate, type Locale } from '@/lib/i18n';
import { oidcConfig, readSession } from '@/lib/session';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { MobileNav } from '@/components/mobile-nav';

export type Section = 'overview' | 'indicators' | 'import' | 'integrations' | 'settings';
const ITEMS: { id: Section; path: string; Icon: typeof Target; key: string }[] = [
  { id: 'overview', path: '', Icon: LayoutDashboard, key: 'nav.overview' },
  { id: 'indicators', path: '/indicators', Icon: Target, key: 'nav.indicators' },
  { id: 'import', path: '/import', Icon: Upload, key: 'nav.import' },
  { id: 'integrations', path: '/integrations', Icon: Plug, key: 'nav.integrations' },
  { id: 'settings', path: '/settings', Icon: Settings2, key: 'nav.settings' },
];

/** Cadre commun : barre latérale (sombre, identique en clair et en sombre), barre supérieure (langue, connexion), contenu. Fonctionne dans les deux sens d'écriture. */
export async function AppShell({ locale, keep = '', section, children }: { locale: Locale; keep?: string; section: Section; children: ReactNode }) {
  const m = messagesFor(locale);
  const t = (k: string, p?: Record<string, string | number>) => translate(m, k, p);
  const session = await readSession();
  const oidc = !!oidcConfig();
  const q = keep ? `?${keep}` : '';
  const path = ITEMS.find((i) => i.id === section)!.path;

  const nav = (
    <nav aria-label={t('nav.main')} data-testid="main-nav" className="flex flex-col gap-1 p-3">
      {ITEMS.map(({ id, path: p, Icon, key }) => (
        <Link key={id} href={`/${locale}${p}${q}`} aria-current={id === section ? 'page' : undefined}
          className={cn('flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            id === section && 'bg-sidebar-active text-white shadow-[inset_3px_0_0_var(--primary)] rtl:shadow-[inset_-3px_0_0_var(--primary)]')}>
          <Icon className="size-4 shrink-0" aria-hidden="true" />{t(key)}
        </Link>
      ))}
    </nav>
  );
  const brand = (
    <div className="flex items-center gap-3 px-5 py-5">
      <span className="grid size-9 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground" aria-hidden="true">N</span>
      <div className="leading-tight"><p className="text-sm font-semibold text-white">{t('app.title')}</p><p className="text-xs text-sidebar-muted">{t('app.tagline')}</p></div>
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16.5rem_minmax(0,1fr)]">
      <a href="#main" className="skip">{t('a11y.skip')}</a>
      <aside className="sticky top-0 hidden h-dvh flex-col border-e border-sidebar-border bg-sidebar lg:flex">
        {brand}{nav}
        <p className="mt-auto px-5 py-4 text-xs text-sidebar-muted">{t('app.footer')}</p>
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/85 px-4 py-2.5 backdrop-blur sm:px-6">
          <MobileNav openLabel={t('nav.open')} closeLabel={t('nav.close')} title={t('app.title')}><div className="bg-sidebar">{brand}{nav}</div></MobileNav>
          <span className="text-sm font-semibold lg:hidden">{t('app.title')}</span>
          <div className="ms-auto flex items-center gap-4">
            <nav aria-label={t('lang.switch')} className="flex items-center gap-3 text-sm">
              {LOCALES.map((l) => (
                <Link key={l} href={`/${l}${path}${q}`} hrefLang={l} lang={l} aria-current={l === locale ? 'page' : undefined}
                  className={cn('rounded px-1.5 py-0.5', l === locale ? 'bg-accent font-semibold text-accent-foreground' : 'text-muted-foreground hover:text-foreground')}>{t(`lang.${l}`)}</Link>
              ))}
            </nav>
            {oidc && (
              <div className="flex items-center gap-2 text-sm" data-testid="auth">
                {session ? (
                  <form method="post" action="/sso/logout" className="flex items-center gap-2">
                    <input type="hidden" name="return" value={`/${locale}`} />
                    {session.name && <span className="hidden items-center gap-1.5 text-muted-foreground sm:flex" data-testid="auth-user"><User className="size-4" aria-hidden="true" />{t('auth.user', { name: session.name })}</span>}
                    <Button type="submit" variant="outline" size="sm"><LogOut />{t('auth.logout')}</Button>
                  </form>
                ) : (
                  <Button asChild size="sm"><a href={`/sso/login?return=${encodeURIComponent(`/${locale}`)}`} data-testid="auth-login"><LogIn />{t('auth.login')}</a></Button>
                )}
              </div>
            )}
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 space-y-6 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
