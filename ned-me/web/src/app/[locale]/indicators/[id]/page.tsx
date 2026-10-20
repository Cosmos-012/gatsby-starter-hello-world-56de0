import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiGet } from '@/lib/api';
import { formatters, isLocale, messagesFor, translate } from '@/lib/i18n';
import type { IndicatorDetail, ProjectConfig } from '@/lib/types';
import { AppShell } from '@/components/app-shell';
import { addValue, moveValue } from './actions';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MSGS = ['saved', 'moved', 'forbidden', 'invalid', 'duplicate', 'conflict'];
const input = 'rounded-md border bg-transparent px-2 py-1.5';
const bd = { borderColor: 'var(--border)' };

export default async function IndicatorPage({ params, searchParams }: { params: Promise<{ locale: string; id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale, id } = await params;
  if (!isLocale(locale) || !UUID.test(id)) notFound();
  const sp = await searchParams;
  const m = messagesFor(locale);
  const t = (k: string, p?: Record<string, string | number>) => translate(m, k, p);
  const f = formatters(locale);
  const msg = typeof sp.msg === 'string' && MSGS.includes(sp.msg) ? sp.msg : undefined;
  const res = await apiGet<IndicatorDetail>(`/indicators/${id}`);
  if (!res.ok) {
    if (res.reason === 'invalid') notFound();
    return <AppShell locale={locale} keep="" section="indicators"><p role="alert" className="card sev-critical">{t(`error.${res.reason}`)}</p></AppShell>;
  }
  const d = res.data;
  const cfg = await apiGet<ProjectConfig>(`/projects/${d.project_id}/config`);
  const fields = cfg.ok ? cfg.data.custom_fields : [];
  const pick = (l: Record<string, string | undefined> | null | undefined) => (l ? l[locale] ?? l.fr ?? l.en ?? l.ar ?? '' : '');
  const hidden = <><input type="hidden" name="locale" value={locale} /><input type="hidden" name="id" value={d.id} /></>;
  const facts: [string, string][] = [
    [t('ind.unit'), d.unit ?? '—'], [t('ind.direction'), t(`ind.dir.${d.direction}`)], [t('ind.frequency'), t(`ind.freq.${d.frequency}`)],
    [t('ind.baseline'), d.baseline == null ? '—' : `${f.num(d.baseline)}${d.baseline_period ? ` (${d.baseline_period})` : ''}`],
    [t('ind.data_source'), d.data_source ?? '—'], [t('ind.method'), d.collection_method ?? '—'], [t('ind.verification'), t(`ind.ver.${d.verification_status}`)],
  ];
  const dims = (v: Record<string, string>) => Object.entries(v).map(([k, x]) => `${k}: ${x}`).join(', ');

  return (
    <AppShell locale={locale} keep="" section="indicators">
      <div className="mx-auto w-full max-w-4xl space-y-6">
        <p><Link href={`/${locale}/indicators?project=${d.project_id}`} className="text-sm underline underline-offset-4">← {t('ind.back')}</Link></p>
        <h1 className="text-2xl font-semibold sm:text-3xl"><span className="muted">{d.code}</span> {pick(d.name)}</h1>
        {d.definition && <p className="secondary">{pick(d.definition)}</p>}
        {msg && <p role="status" className={`card ${['saved', 'moved'].includes(msg) ? '' : 'sev-critical'}`} data-testid="ind-msg">{t(`ind.msg.${msg}`)}</p>}

        <section className="card" aria-labelledby="def">
          <h2 id="def" className="sr-only">{t('ind.definition')}</h2>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {facts.map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="secondary">{k}</dt><dd className="font-semibold">{v}</dd></div>)}
            {fields.map((fd) => {
              const raw = d.attributes[fd.key];
              const shown = raw == null || raw === '' ? '—' : fd.type === 'select' ? pick(fd.options?.find((o) => o.value === raw)?.label) || String(raw) : fd.type === 'boolean' ? (raw ? '✓' : '✗') : String(raw);
              return <div key={fd.key} className="flex justify-between gap-3" data-testid={`attr-${fd.key}`}><dt className="secondary">{pick(fd.label)}</dt><dd className="font-semibold">{shown}</dd></div>;
            })}
          </dl>
        </section>

        <section className="card space-y-3" aria-labelledby="vals">
          <h2 id="vals" className="font-semibold">{t('ind.values')}</h2>
          {d.values.length === 0 ? <p className="muted">{t('ind.values_none')}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="values-table">
                <thead><tr className="secondary">{['period', 'kind', 'value', 'state', 'comment', 'actions'].map((c) => <th key={c} scope="col" className="px-2 py-2 text-start font-medium">{t(`ind.val.${c}`)}</th>)}</tr></thead>
                <tbody>
                  {d.values.map((v) => (
                    <tr key={v.id} className="border-t align-top" style={bd} data-testid={`value-${v.period}-${v.kind}`}>
                      <td className="px-2 py-2">{v.period}<span className="block text-xs muted">{v.period_end}</span></td>
                      <td className="px-2 py-2">{t(`ind.kind.${v.kind}`)}{Object.keys(v.dimensions).length > 0 && <span className="block text-xs muted">{t('ind.dims')} : {dims(v.dimensions)}</span>}</td>
                      <td className="num px-2 py-2 font-semibold">{f.num(v.value)}</td>
                      <td className="px-2 py-2" data-testid={`state-${v.period}-${v.kind}`}>{t(`ind.state.${v.workflow_state}`)}</td>
                      <td className="px-2 py-2">{v.comment ?? ''}</td>
                      <td className="px-2 py-2">
                        <div className="flex flex-wrap gap-2">
                          {v.next.map((to) => (
                            <form key={to} action={moveValue}>{hidden}<input type="hidden" name="value_id" value={v.id} /><input type="hidden" name="to" value={to} />
                              <button type="submit" className="link-btn">{t(`ind.go.${to}`)}</button></form>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs muted">{t('ind.note')}</p>
        </section>

        <form action={addValue} className="card space-y-3" data-testid="form-add-value">
          {hidden}
          <h2 className="font-semibold">{t('ind.enter')}</h2>
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="flex flex-col gap-1 text-sm"><span className="secondary">{t('ind.val.kind')}</span>
              <select name="kind" className={input} style={bd}><option value="actual">{t('ind.kind.actual')}</option><option value="target">{t('ind.kind.target')}</option></select></label>
            <label className="flex flex-col gap-1 text-sm"><span className="secondary">{t('ind.period_label')}</span><input name="period" required minLength={4} className={input} style={bd} dir="ltr" /></label>
            <label className="flex flex-col gap-1 text-sm"><span className="secondary">{t('ind.period_end')}</span><input type="date" name="period_end" required className={input} style={bd} /></label>
            <label className="flex flex-col gap-1 text-sm"><span className="secondary">{t('ind.val.value')}</span><input name="value" required inputMode="decimal" className={input} style={bd} dir="ltr" /></label>
          </div>
          <label className="flex flex-col gap-1 text-sm"><span className="secondary">{t('ind.val.comment')}</span><input name="comment" maxLength={1000} className={input} style={bd} /></label>
          <button type="submit" className="rounded-md px-4 py-2 text-sm font-medium text-white" style={{ background: 'var(--bar)' }}>{t('ind.save_value')}</button>
        </form>
      </div>
    </AppShell>
  );
}
