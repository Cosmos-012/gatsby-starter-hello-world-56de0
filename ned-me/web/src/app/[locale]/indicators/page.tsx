import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiGet } from '@/lib/api';
import { formatters, isLocale, messagesFor, translate } from '@/lib/i18n';
import type { IndicatorListItem, Project, ProjectConfig, Status, TrackingRow } from '@/lib/types';
import { Header } from '../chrome';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES: Status[] = ['RED', 'AMBER', 'GREEN', 'GREY'];
const ICON: Record<Status, string> = { GREEN: '✓', AMBER: '!', RED: '✕', GREY: '–' };
const TREND_ICON = { improving: '↗', declining: '↘', flat: '→', insufficient: '·' } as const;
const input = 'rounded-md border bg-transparent px-2 py-1.5';
const bd = { borderColor: 'var(--border)' };

export default async function IndicatorsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  const m = messagesFor(locale);
  const t = (k: string, p?: Record<string, string | number>) => translate(m, k, p);
  const f = formatters(locale);
  const project = typeof sp.project === 'string' && UUID.test(sp.project) ? sp.project : undefined;
  const status = typeof sp.status === 'string' && (STATUSES as string[]).includes(sp.status) ? sp.status : undefined;
  const q = new URLSearchParams({ ...(project ? { project_id: project } : {}), ...(status ? { status } : {}) });
  const [projects, rows, items, cfg] = await Promise.all([
    apiGet<Project[]>('/projects'), apiGet<TrackingRow[]>(`/indicators/tracking?${q}`),
    apiGet<IndicatorListItem[]>(`/indicators?${new URLSearchParams(project ? { project_id: project } : {})}`),
    project ? apiGet<ProjectConfig>(`/projects/${project}/config`) : Promise.resolve(null),
  ]);
  const keep = project ? `project=${project}` : '';
  const attrs = new Map((items.ok ? items.data : []).map((i) => [i.id, i.attributes]));
  const fields = cfg && cfg.ok ? cfg.data.custom_fields : [];
  const pick = (l: Record<string, string | undefined> | null | undefined) => (l ? l[locale] ?? l.fr ?? l.en ?? l.ar ?? '' : '');
  const ratio = (v: number | null) => (v == null ? '—' : f.ratio(v));
  const fieldValue = (key: string, v: unknown) => {
    const def = fields.find((x) => x.key === key);
    if (v == null || v === '') return '—';
    if (def?.type === 'select') return pick(def.options?.find((o) => o.value === v)?.label) || String(v);
    if (def?.type === 'boolean') return v ? '✓' : '✗';
    return typeof v === 'number' ? f.num(v) : String(v);
  };

  return (
    <>
      <a href="#main" className="skip">{t('a11y.skip')}</a>
      <Header locale={locale} keep={keep} section="indicators" />
      <main id="main" className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
        <h1 className="text-2xl font-semibold sm:text-3xl">{t('ind.title')}</h1>
        <form method="get" className="card flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-sm"><span className="secondary">{t('filter.project')}</span>
            <select name="project" defaultValue={project ?? ''} className={`min-w-56 ${input}`} style={bd}>
              <option value="">{t('filter.all_projects')}</option>
              {projects.ok && projects.data.map((pr) => <option key={pr.id} value={pr.id}>{pr.code} — {pr.name[locale] ?? pr.name.fr ?? pr.name.en ?? pr.name.ar ?? ''}</option>)}
            </select></label>
          <label className="flex flex-col gap-1 text-sm"><span className="secondary">{t('ind.status')}</span>
            <select name="status" defaultValue={status ?? ''} className={input} style={bd}>
              <option value="">{t('ind.all_statuses')}</option>
              {STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
            </select></label>
          <button type="submit" className="rounded-md px-4 py-1.5 text-sm font-medium text-white" style={{ background: 'var(--bar)' }}>{t('filter.apply')}</button>
        </form>

        {!rows.ok ? <p role="alert" className="card sev-critical">{t(`error.${rows.reason}`)}</p>
          : rows.data.length === 0 ? <p className="card muted" data-testid="ind-none">{t('ind.none')}</p> : (
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm" data-testid="ind-table">
              <thead>
                <tr className="text-start secondary">
                  {['code', 'name', 'actual', 'target', 'gap', 'achievement', 'status', 'trend', 'risk'].map((c) => <th key={c} scope="col" className="px-3 py-2 text-start font-medium">{t(`ind.col.${c}`)}</th>)}
                  {fields.map((fd) => <th key={fd.key} scope="col" className="px-3 py-2 text-start font-medium">{pick(fd.label)}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.data.map((r) => (
                  <tr key={r.indicator_id} data-testid={`ind-row-${r.code}`} className="border-t" style={bd}>
                    <td className="px-3 py-2 font-semibold"><Link className="underline underline-offset-4" href={`/${locale}/indicators/${r.indicator_id}${keep ? `?${keep}` : ''}`}>{r.code}</Link></td>
                    <td className="px-3 py-2">{pick(r.name)}{r.unit ? <span className="muted"> ({r.unit})</span> : null}</td>
                    <td className="num px-3 py-2">{r.actual == null ? '—' : f.num(r.actual)}</td>
                    <td className="num px-3 py-2">{r.target == null ? '—' : f.num(r.target)}</td>
                    <td className="num px-3 py-2">{r.gap == null ? '—' : f.num(r.gap)}</td>
                    <td className="px-3 py-2" style={{ minWidth: '7rem' }}>
                      <span className="num font-semibold" data-testid={`ind-ach-${r.code}`}>{ratio(r.achievement)}</span>
                      <div className="bar-track mt-1" aria-hidden="true">{r.achievement != null && <div className="bar-fill" style={{ width: `${Math.min(100, Math.max(0, r.achievement * 100))}%` }} />}</div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap" data-testid={`ind-status-${r.code}`}>
                      <span className={`dot dot-${r.status}`} aria-hidden="true" /> <span aria-hidden="true" className="font-bold">{ICON[r.status]}</span> {t(`status.${r.status}`)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap"><span aria-hidden="true">{TREND_ICON[r.trend]}</span> {t(`ind.trend.${r.trend}`)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.at_risk == null ? t('ind.risk.unknown') : r.at_risk ? t('ind.risk.yes') : t('ind.risk.no')}</td>
                    {fields.map((fd) => <td key={fd.key} className="px-3 py-2">{fieldValue(fd.key, (attrs.get(r.indicator_id) ?? {})[fd.key])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs muted">{t('ind.note')}</p>
      </main>
    </>
  );
}
