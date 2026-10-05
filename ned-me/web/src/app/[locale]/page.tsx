import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiGet, isDevToken } from '@/lib/api';
import { formatters, isLocale, LOCALES, messagesFor, translate, translatePlural } from '@/lib/i18n';
import type { Overview, Project, Status } from '@/lib/types';

export const dynamic = 'force-dynamic';

const STATUS_ORDER: Status[] = ['RED', 'AMBER', 'GREEN', 'GREY'];
const STATUS_ICON: Record<Status, string> = { GREEN: '✓', AMBER: '!', RED: '✕', GREY: '–' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Date réelle (refuse 2026-13-45, 2026-02-30) : le format seul ne suffit pas. */
const isRealDate = (s: string) => {
  if (!DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;   // une date invalide ferait lever toISOString()
};

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function OverviewPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: SP }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  const m = messagesFor(locale);
  const t = (k: string, p?: Record<string, string | number>) => translate(m, k, p);
  const f = formatters(locale);

  // Paramètres validés avant d'être transmis à l'API (jamais de chaîne brute dans l'URL d'appel).
  const project = typeof sp.project === 'string' && UUID.test(sp.project) ? sp.project : undefined;
  const asOf = typeof sp.as_of === 'string' && isRealDate(sp.as_of) ? sp.as_of : undefined;
  const q = new URLSearchParams({ ...(project ? { project_id: project } : {}), ...(asOf ? { as_of: asOf } : {}) });

  const [projects, overview] = await Promise.all([apiGet<Project[]>('/projects'), apiGet<Overview>(`/dashboard/overview?${q}`)]);

  const keep = new URLSearchParams({ ...(project ? { project } : {}), ...(asOf ? { as_of: asOf } : {}) }).toString();
  const header = (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-sm muted">{t('app.title')}</p>
        <h1 className="text-2xl font-semibold">{t('app.question')}</h1>
      </div>
      <nav aria-label={t('lang.switch')} className="flex gap-3 text-sm">
        {LOCALES.map((l) => (
          <Link key={l} href={`/${l}${keep ? `?${keep}` : ''}`} hrefLang={l} lang={l} aria-current={l === locale ? 'page' : undefined}
            className={l === locale ? 'font-semibold underline underline-offset-4' : 'secondary hover:underline'}>{t(`lang.${l}`)}</Link>
        ))}
      </nav>
    </header>
  );

  if (!overview.ok) {
    return (
      <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
        {header}
        <p role="alert" className="card sev-critical">{t(`error.${overview.reason}`)}</p>
      </main>
    );
  }
  const o = overview.data;
  const p = o.performance;

  const ratioOrNone = (v: number | null) => (v == null ? t('kpi.no_data') : f.ratio(v));
  const alertText = (a: Overview['alerts'][number]) => {
    const params: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(a.params)) {
      if (k === 'achievement' && typeof v === 'number') params[k] = f.ratio(v);
      else if (typeof v === 'number') params[k] = f.num(v);
      else params[k] = String(v);
    }
    // Le nombre qui commande l'accord (count ou days_late) choisit la forme plurielle.
    const n = [a.params.count, a.params.days_late].find((v): v is number => typeof v === 'number');
    return n == null ? t(`alert.${a.type}`, params) : translatePlural(m, locale, `alert.${a.type}`, n, params);
  };

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      {isDevToken() && <p className="rounded-md border px-3 py-2 text-xs secondary" style={{ borderColor: 'var(--border)' }}>{t('dev.banner')}</p>}
      {header}

      <form method="get" className="card flex flex-wrap items-end gap-4" aria-label={t('filter.project')}>
        <label className="flex flex-col gap-1 text-sm">
          <span className="secondary">{t('filter.project')}</span>
          <select name="project" defaultValue={project ?? ''} className="min-w-56 rounded-md border bg-transparent px-2 py-1.5" style={{ borderColor: 'var(--border)' }}>
            <option value="">{t('filter.all_projects')}</option>
            {projects.ok && projects.data.map((pr) => (
              <option key={pr.id} value={pr.id}>{pr.code} — {pr.name[locale] ?? pr.name.fr ?? pr.name.en ?? pr.name.ar ?? ''}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="secondary">{t('filter.as_of')}</span>
          <input type="date" name="as_of" defaultValue={asOf ?? o.as_of} className="rounded-md border bg-transparent px-2 py-1.5" style={{ borderColor: 'var(--border)' }} />
        </label>
        <button type="submit" className="rounded-md px-4 py-1.5 text-sm font-medium text-white" style={{ background: 'var(--bar)' }}>{t('filter.apply')}</button>
        <p className="text-sm muted ms-auto">{t('common.as_of', { date: f.date(o.as_of) })}</p>
      </form>

      {/* Chiffres clés */}
      <section aria-labelledby="kpis" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <h2 id="kpis" className="sr-only">{t('kpi.overall')}</h2>
        <Kpi testId="kpi-overall" label={t('kpi.overall')} value={ratioOrNone(p.overall)} hint={t('kpi.overall_hint')} source={p.source} sourceLabel={t('common.source')} />
        <Kpi testId="kpi-coverage" label={t('kpi.coverage')} value={ratioOrNone(p.coverage)} hint={t('kpi.coverage_hint', { with: f.num(p.with_data), total: f.num(p.indicators_total) })} source={p.source} sourceLabel={t('common.source')} />
        <Kpi testId="kpi-dq" label={t('kpi.dq')} value={o.data_quality.average_score == null ? t('kpi.no_data') : `${f.num(o.data_quality.average_score)} / ${f.num(100)}`} ltr
          hint={t('kpi.dq_hint', { errors: f.num(o.data_quality.open_issues.error), warnings: f.num(o.data_quality.open_issues.warning) })} source={o.data_quality.source} sourceLabel={t('common.source')} />
        <Kpi testId="kpi-at-risk" label={t('kpi.at_risk')} value={f.num(p.forecast_at_risk)} hint={t('kpi.at_risk_hint')} source={p.source} sourceLabel={t('common.source')} />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Statuts : icône + libellé + couleur réservée, jamais la couleur seule */}
        <section aria-labelledby="status" className="card space-y-3">
          <h2 id="status" className="font-semibold">{t('status.title')}</h2>
          <ul className="space-y-2">
            {STATUS_ORDER.map((s) => (
              <li key={s} data-testid={`status-${s}`} className="flex items-center gap-3">
                <span className={`dot dot-${s}`} aria-hidden="true" />
                <span aria-hidden="true" className="w-4 text-center text-sm font-bold">{STATUS_ICON[s]}</span>
                <span className="flex-1">{t(`status.${s}`)}</span>
                <span className="num font-semibold">{f.num(p.by_status[s] ?? 0)}</span>
              </li>
            ))}
          </ul>
          <p className="src">{t('common.source')} : <code>{p.source}</code></p>
        </section>

        {/* Niveaux de résultats : une seule série, valeur écrite à côté de chaque barre */}
        <section aria-labelledby="levels" className="card space-y-3 lg:col-span-2">
          <h2 id="levels" className="font-semibold">{t('levels.title')}</h2>
          <ul className="space-y-3">
            {p.by_result_level.map((l) => (
              <li key={l.level} data-testid={`level-${l.level}`} title={`${t(`levels.${l.level}`)} : ${ratioOrNone(l.avg_achievement)} — ${t('levels.count', { withData: f.num(l.with_data), n: f.num(l.indicators) })}`}>
                <div className="flex justify-between gap-2 text-sm">
                  <span>{t(`levels.${l.level}`)}</span>
                  <span className="num font-semibold">{ratioOrNone(l.avg_achievement)}</span>
                </div>
                <div className="bar-track mt-1" aria-hidden="true">
                  {l.avg_achievement != null && <div className="bar-fill" style={{ width: `${Math.min(100, Math.max(0, l.avg_achievement * 100))}%` }} />}
                </div>
                <p className="mt-1 text-xs muted">{t('levels.count', { withData: f.num(l.with_data), n: f.num(l.indicators) })}</p>
              </li>
            ))}
          </ul>
          <p className="src">{t('common.source')} : <code>{p.source}</code></p>
        </section>
      </div>

      {/* Alertes : triées critique d'abord par l'API */}
      <section aria-labelledby="alerts" className="card space-y-3">
        <h2 id="alerts" className="font-semibold">{t('alerts.title')}</h2>
        {o.alerts.length === 0 ? <p className="muted">{t('alerts.none')}</p> : (
          <ul className="space-y-2" data-testid="alerts">
            {o.alerts.map((a, i) => (
              <li key={`${a.type}-${i}`} data-testid="alert" data-type={a.type} className="flex items-start gap-3">
                <span className={`sev-${a.severity} shrink-0 text-xs font-semibold uppercase`}>
                  <span aria-hidden="true">{a.severity === 'critical' ? '⛔ ' : '⚠ '}</span>{t(`severity.${a.severity}`)}
                </span>
                <span>{alertText(a)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Facts testId="block-evaluations" title={t('eval.title')} source={o.evaluations.source} sourceLabel={t('common.source')} rows={[
          [t('eval.total'), f.num(o.evaluations.recommendations.total)],
          [t('eval.closure_rate'), o.evaluations.recommendations.closure_rate == null ? t('common.no_data') : f.percent(o.evaluations.recommendations.closure_rate)],
          [t('eval.unanswered'), f.num(o.evaluations.recommendations.unanswered)],
          [t('eval.overdue_actions'), f.num(o.evaluations.recommendations.overdue_actions)],
        ]} />
        <Facts testId="block-accountability" title={t('acc.title')} source={o.accountability.source} sourceLabel={t('common.source')} rows={[
          [t('acc.open'), f.num(o.accountability.open_feedback)],
          [t('acc.overdue_resolution'), f.num(o.accountability.overdue_resolution)],
          [t('acc.overdue_ack'), f.num(o.accountability.overdue_acknowledgement)],
          [t('acc.satisfaction'), o.accountability.satisfaction_avg == null ? t('common.no_data') : f.num(o.accountability.satisfaction_avg)],
        ]} />
        <Facts testId="block-risks" title={t('risk.title')} source={o.risks.source} sourceLabel={t('common.source')} rows={[
          [t('risk.open'), f.num(o.risks.open_total)],
          [t('risk.critical'), f.num(o.risks.open_by_level.critical)],
          [t('risk.unescalated'), f.num(o.risks.critical_unescalated)],
          [t('risk.issues'), f.num(o.risks.open_issues_total)],
          [t('risk.overdue_issues'), f.num(o.risks.overdue_issues)],
        ]} />
        <Facts testId="block-learning" title={t('learn.title')} source={o.learning.source} sourceLabel={t('common.source')} rows={[[t('learn.total'), f.num(o.learning.total)]]} />
      </div>

      {o.not_available.length > 0 && (
        <section aria-labelledby="na" className="card space-y-1" data-testid="not-available">
          <h2 id="na" className="font-semibold">{t('na.title')}</h2>
          <p className="text-sm">{o.not_available.map((n) => t(`na.${n}`)).join(' · ')}</p>
          <p className="text-xs muted">{t('na.note')}</p>
        </section>
      )}
    </main>
  );
}

function Kpi({ label, value, hint, source, sourceLabel, testId, ltr }: { label: string; value: string; hint: string; source: string; sourceLabel: string; testId: string; ltr?: boolean }) {
  return (
    <div className="card space-y-1" data-testid={testId}>
      <p className="text-sm secondary">{label}</p>
      {/* une fraction (« 50 / 100 ») reste lisible gauche-droite en arabe ; sinon elle s'inverse */}
      <p className="num text-3xl font-semibold" data-testid={`${testId}-value`}>{ltr ? <bdi dir="ltr">{value}</bdi> : value}</p>
      <p className="text-xs muted">{hint}</p>
      <p className="src">{sourceLabel} : <code>{source}</code></p>
    </div>
  );
}

function Facts({ title, rows, source, sourceLabel, testId }: { title: string; rows: [string, string][]; source: string; sourceLabel: string; testId: string }) {
  return (
    <section className="card space-y-2" data-testid={testId}>
      <h2 className="font-semibold">{title}</h2>
      <dl className="space-y-1 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="secondary">{k}</dt>
            <dd className="num font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="src">{sourceLabel} : <code>{source}</code></p>
    </section>
  );
}
