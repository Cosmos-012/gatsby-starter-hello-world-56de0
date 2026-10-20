import { notFound } from 'next/navigation';
import { apiGet } from '@/lib/api';
import { isLocale, messagesFor, translate } from '@/lib/i18n';
import type { ConfigCatalog, Label, Project, ProjectConfig } from '@/lib/types';
import { AppShell } from '@/components/app-shell';
import { addField, applyTemplate, removeField, saveGeneral } from './actions';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEVELS = ['impact', 'outcome', 'output'] as const;
const LANGS = ['fr', 'en', 'ar'] as const;
const MSGS = ['saved', 'conflict', 'in_use', 'invalid', 'forbidden'];
const input = 'rounded-md border bg-transparent px-2 py-1.5';
const bd = { borderColor: 'var(--border)' };

export default async function SettingsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  const m = messagesFor(locale);
  const t = (k: string, p?: Record<string, string | number>) => translate(m, k, p);
  const pick = (l: Label) => l[locale] ?? l.fr ?? l.en ?? l.ar ?? '';
  const project = typeof sp.project === 'string' && UUID.test(sp.project) ? sp.project : undefined;
  const msg = typeof sp.msg === 'string' && MSGS.includes(sp.msg) ? sp.msg : undefined;

  const [projects, catalog, cfg] = await Promise.all([
    apiGet<Project[]>('/projects'), apiGet<ConfigCatalog>('/config/templates'),
    project ? apiGet<ProjectConfig>(`/projects/${project}/config`) : Promise.resolve(null),
  ]);
  const keep = project ? `project=${project}` : '';

  return (
    <AppShell locale={locale} keep={keep} section="settings">
      <div className="mx-auto w-full max-w-4xl space-y-6">
        <h1 className="text-2xl font-semibold sm:text-3xl">{t('settings.title')}</h1>
        {msg && <p role="status" className={`card ${msg === 'saved' ? '' : 'sev-critical'}`} data-testid="settings-msg">{t(`settings.${msg}`)}</p>}
        {!projects.ok && <p role="alert" className="card sev-critical">{t(`error.${projects.reason}`)}</p>}

        <form method="get" className="card flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="secondary">{t('settings.project')}</span>
            <select name="project" defaultValue={project ?? ''} className={`min-w-56 ${input}`} style={bd}>
              <option value="">—</option>
              {projects.ok && projects.data.map((pr) => <option key={pr.id} value={pr.id}>{pr.code} — {pr.name[locale] ?? pr.name.fr ?? pr.name.en ?? pr.name.ar ?? ''}</option>)}
            </select>
          </label>
          <button type="submit" className="rounded-md px-4 py-1.5 text-sm font-medium text-white" style={{ background: 'var(--bar)' }}>{t('filter.apply')}</button>
        </form>

        {!project && <p className="muted">{t('settings.choose')}</p>}
        {project && (!cfg || !cfg.ok || !catalog.ok) && <p role="alert" className="card sev-critical">{t(`error.${cfg && !cfg.ok ? cfg.reason : 'api'}`)}</p>}

        {project && cfg && cfg.ok && catalog.ok && (() => {
          const c = cfg.data;
          const hidden = (
            <>
              <input type="hidden" name="locale" value={locale} /><input type="hidden" name="project" value={project} /><input type="hidden" name="version" value={c.version} />
            </>
          );
          const widgets = c.dashboard.widgets;
          return (
            <>
              <p className="text-sm muted" data-testid="config-version">{t('settings.version', { version: c.version })}</p>

              <form action={applyTemplate} className="card space-y-3" data-testid="form-template">
                {hidden}
                <h2 className="font-semibold">{t('settings.template')}</h2>
                <div className="flex flex-wrap items-end gap-3">
                  <select name="template" defaultValue={c.template} className={input} style={bd} aria-label={t('settings.template')}>
                    {catalog.data.templates.map((tp) => <option key={tp.id} value={tp.id}>{pick(tp.label)}</option>)}
                  </select>
                  <button type="submit" className="link-btn">{t('settings.apply_template')}</button>
                </div>
                <p className="text-xs muted">{t('settings.template_warn')}</p>
              </form>

              <form action={saveGeneral} className="space-y-6" data-testid="form-general">
                {hidden}
                <input type="hidden" name="module_keys" value={catalog.data.modules.filter((x) => !x.core).map((x) => x.key).join(',')} />
                <input type="hidden" name="widget_ids" value={widgets.map((w) => w.id).join(',')} />

                <section className="card space-y-3" aria-labelledby="mods">
                  <h2 id="mods" className="font-semibold">{t('settings.modules')}</h2>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {catalog.data.modules.map((mod) => (
                      <li key={mod.key} className="flex items-start gap-2 text-sm">
                        {mod.core
                          ? <input type="checkbox" checked disabled aria-label={t(`settings.module.${mod.key}`)} />
                          : <input type="checkbox" name={`mod_${mod.key}`} defaultChecked={c.modules[mod.key]} id={`mod_${mod.key}`} />}
                        <label htmlFor={`mod_${mod.key}`}>
                          {t(`settings.module.${mod.key}`)}
                          {mod.core && <span className="block text-xs muted">{t('settings.core')}</span>}
                          {!mod.built && <span className="block text-xs muted">{t('settings.not_built')}</span>}
                        </label>
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="card space-y-3" aria-labelledby="wids">
                  <h2 id="wids" className="font-semibold">{t('settings.widgets')}</h2>
                  <p className="text-xs muted">{t('settings.widgets_hint')}</p>
                  <ul className="space-y-2">
                    {widgets.map((w, i) => (
                      <li key={w.id} className="flex items-center gap-3 text-sm">
                        <input type="number" name={`w_${w.id}_order`} defaultValue={i + 1} min={1} max={99} className={`w-16 ${input}`} style={bd} aria-label={`${t('settings.order')} — ${t(`settings.widget.${w.id}`)}`} />
                        <input type="checkbox" name={`w_${w.id}_visible`} defaultChecked={w.visible} id={`w_${w.id}`} />
                        <label htmlFor={`w_${w.id}`}>{t(`settings.widget.${w.id}`)}</label>
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="card space-y-3" aria-labelledby="lvls">
                  <h2 id="lvls" className="font-semibold">{t('settings.levels')}</h2>
                  <p className="text-xs muted">{t('settings.levels_hint')}</p>
                  {LEVELS.map((lv) => (
                    <fieldset key={lv} className="grid gap-2 sm:grid-cols-4 sm:items-center">
                      <legend className="sr-only">{t(`levels.${lv}`)}</legend>
                      <span className="text-sm secondary">{t(`levels.${lv}`)}</span>
                      {LANGS.map((l) => (
                        <input key={l} name={`lv_${lv}_${l}`} defaultValue={c.terminology.level_labels[lv]?.[l] ?? ''} lang={l} dir={l === 'ar' ? 'rtl' : 'ltr'} maxLength={200}
                          placeholder={t(`lang.${l}`)} aria-label={`${t(`levels.${lv}`)} — ${t(`lang.${l}`)}`} className={input} style={bd} />
                      ))}
                    </fieldset>
                  ))}
                </section>
                <button type="submit" className="rounded-md px-5 py-2 text-sm font-medium text-white" style={{ background: 'var(--bar)' }}>{t('settings.save')}</button>
              </form>

              <section className="card space-y-4" aria-labelledby="flds" data-testid="custom-fields">
                <h2 id="flds" className="font-semibold">{t('settings.fields')}</h2>
                {c.custom_fields.length === 0 ? <p className="muted">{t('settings.fields_none')}</p> : (
                  <ul className="space-y-2">
                    {c.custom_fields.map((f) => (
                      <li key={f.key} className="flex flex-wrap items-center gap-3 text-sm" data-testid={`field-${f.key}`}>
                        <code className="text-xs">{f.key}</code>
                        <span className="flex-1">{pick(f.label)}</span>
                        <span className="secondary">{t(`settings.type.${f.type}`)}{f.required ? ` · ${t('settings.field_required')}` : ''}</span>
                        <form action={removeField}>
                          {hidden}<input type="hidden" name="key" value={f.key} />
                          <button type="submit" className="link-btn">{t('settings.field_remove')}</button>
                        </form>
                      </li>
                    ))}
                  </ul>
                )}
                <form action={addField} className="space-y-3 border-t pt-4" style={bd} data-testid="form-add-field">
                  {hidden}
                  <h3 className="text-sm font-semibold">{t('settings.field_add')}</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-sm"><span className="secondary">{t('settings.field_key')}</span>
                      <input name="key" required pattern="[a-z][a-z0-9_]{1,30}" className={input} style={bd} dir="ltr" /></label>
                    <label className="flex flex-col gap-1 text-sm"><span className="secondary">{t('settings.field_type')}</span>
                      <select name="type" className={input} style={bd}>{(['text', 'number', 'select', 'date', 'boolean'] as const).map((ty) => <option key={ty} value={ty}>{t(`settings.type.${ty}`)}</option>)}</select></label>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {LANGS.map((l) => (
                      <label key={l} className="flex flex-col gap-1 text-sm"><span className="secondary">{t('settings.field_label')} — {t(`lang.${l}`)}</span>
                        <input name={`label_${l}`} lang={l} dir={l === 'ar' ? 'rtl' : 'ltr'} maxLength={200} className={input} style={bd} /></label>
                    ))}
                  </div>
                  <label className="flex flex-col gap-1 text-sm"><span className="secondary">{t('settings.field_options')}</span>
                    <textarea name="options" rows={3} className={input} style={bd} dir="ltr" /></label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="required" />{t('settings.field_required')}</label>
                  <button type="submit" className="link-btn">{t('settings.field_add')}</button>
                </form>
              </section>
            </>
          );
        })()}
      </div>
    </AppShell>
  );
}
