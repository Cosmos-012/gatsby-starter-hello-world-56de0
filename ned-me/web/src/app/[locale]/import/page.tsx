import { notFound } from 'next/navigation';
import { apiGet } from '@/lib/api';
import { isLocale, messagesFor, translate } from '@/lib/i18n';
import type { Project } from '@/lib/types';
import { AppShell } from '@/components/app-shell';
import { ImportForm } from './form';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const input = 'rounded-md border bg-transparent px-2 py-1.5';
const bd = { borderColor: 'var(--border)' };
const TEMPLATE = 'indicator_code,period,period_end,kind,value,comment,dim_region\nA,2026-Q2,2026-06-30,actual,96.5,,\n';

export default async function ImportPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  const m = messagesFor(locale);
  const t = (k: string) => translate(m, k);
  const project = typeof sp.project === 'string' && UUID.test(sp.project) ? sp.project : undefined;
  const projects = await apiGet<Project[]>('/projects');
  const msg = Object.fromEntries(['format', 'forbidden', 'errors', 'too_big', 'nofile', 'api'].map((k) => [k, translate(m, `imp.msg.${k}`, { detail: '{detail}' })]));
  return (
    <AppShell locale={locale} keep={project ? `project=${project}` : ''} section="import">
      <div className="mx-auto w-full max-w-4xl space-y-6">
        <h1 className="text-2xl font-semibold sm:text-3xl">{t('imp.title')}</h1>
        <p className="secondary text-sm">{t('imp.intro')}</p>
        <p><a className="link-btn inline-block" href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`} download="modele-import.csv">{t('imp.template')}</a></p>
        <form method="get" className="card flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-sm"><span className="secondary">{t('filter.project')}</span>
            <select name="project" defaultValue={project ?? ''} className={`min-w-56 ${input}`} style={bd}>
              <option value="">—</option>
              {projects.ok && projects.data.map((pr) => <option key={pr.id} value={pr.id}>{pr.code} — {pr.name[locale] ?? pr.name.fr ?? pr.name.en ?? pr.name.ar ?? ''}</option>)}
            </select></label>
          <button type="submit" className="rounded-md px-4 py-1.5 text-sm font-medium text-white" style={{ background: 'var(--bar)' }}>{t('filter.apply')}</button>
        </form>
        {project && (
          <ImportForm locale={locale} project={project} labels={{
            file: t('imp.file'), preview: t('imp.preview'), commit: t('imp.commit'), total: t('imp.total'), allOrNothing: t('imp.all_or_nothing'), truncated: t('imp.truncated'),
            line: t('imp.line'), status: t('imp.status'), ok: t('imp.ok'), error: t('imp.error'), done: t('imp.done'), msg, template: t('imp.template'), errorsMsg: t('imp.msg.errors'),
          }} />
        )}
      </div>
    </AppShell>
  );
}
