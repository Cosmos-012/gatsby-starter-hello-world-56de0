import { notFound } from 'next/navigation';
import { apiGet } from '@/lib/api';
import { isLocale, messagesFor, translate } from '@/lib/i18n';
import type { Project } from '@/lib/types';
import { AppShell } from '@/components/app-shell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConnectorCard, type Field } from './form';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type L = { fr?: string; en?: string; ar?: string };
interface Descriptor { id: string; label: L; description?: L; form: { name: string; label: L; type: string; required?: boolean; hint?: L; placeholder?: string; options?: { value: string; label: L }[] }[] }

export default async function IntegrationsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  const m = messagesFor(locale);
  const t = (k: string, p?: Record<string, string | number>) => translate(m, k, p);
  const pick = (l?: L) => l?.[locale] ?? l?.fr ?? l?.en ?? l?.ar ?? '';
  const project = typeof sp.project === 'string' && UUID.test(sp.project) ? sp.project : undefined;
  const [projects, connectors] = await Promise.all([apiGet<Project[]>('/projects'), apiGet<Descriptor[]>('/integrations')]);
  const reasons = Object.fromEntries(['unknown_connector', 'invalid_config', 'pull_failed', 'too_many_rows', 'unknown_project', 'forbidden', 'api'].map((k) => [k, t(`int.reason.${k}`, { detail: '{detail}' })]));
  const labels = { run: t('int.run'), running: t('int.running'), skipExisting: t('int.skip_existing'), skipHint: t('int.skip_hint'), secret: t('int.secret'), line: t('imp.line'), status: t('imp.status'), ok: t('imp.ok'), error: t('imp.error'),
    okDone: t('int.ok_done', { n: '{n}', s: '{s}' }), hasErrors: t('int.has_errors', { n: '{n}' }), reasons };
  return (
    <AppShell locale={locale} keep={project ? `project=${project}` : ''} section="integrations">
      <div className="mx-auto w-full max-w-4xl space-y-6">
        <div className="space-y-1"><h1 className="text-2xl font-semibold sm:text-3xl">{t('int.title')}</h1><p className="text-sm text-muted-foreground">{t('int.intro')}</p></div>
        <Card><CardContent className="pt-5">
          <form method="get" className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5"><Label htmlFor="int-project">{t('filter.project')}</Label>
              <Select id="int-project" name="project" defaultValue={project ?? ''} className="min-w-56">
                <option value="">—</option>
                {projects.ok && projects.data.map((pr) => <option key={pr.id} value={pr.id}>{pr.code} — {pr.name[locale] ?? pr.name.fr ?? pr.name.en ?? pr.name.ar ?? ''}</option>)}
              </Select></div>
            <Button type="submit" variant="secondary">{t('filter.apply')}</Button>
          </form>
        </CardContent></Card>
        {!connectors.ok && <p role="alert" className="text-sm text-critical-ink">{t(connectors.reason === 'forbidden' ? 'int.reason.forbidden' : 'int.reason.api', { detail: '' })}</p>}
        {connectors.ok && !project && <p className="text-sm text-muted-foreground">{t('int.pick_project')}</p>}
        {connectors.ok && project && connectors.data.map((c) => (
          <ConnectorCard key={c.id} locale={locale} project={project} id={c.id} title={pick(c.label)} description={pick(c.description)} labels={labels}
            fields={c.form.map<Field>((f) => ({ name: f.name, label: pick(f.label), type: f.type, required: f.required, hint: f.hint ? pick(f.hint) : undefined, placeholder: f.placeholder,
              options: f.options?.map((o) => ({ value: o.value, label: pick(o.label) })) }))} />
        ))}
        <p className="text-xs text-muted-foreground">{t('int.extend')}</p>
      </div>
    </AppShell>
  );
}
