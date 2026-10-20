'use server';
import { redirect } from 'next/navigation';
import { apiGet, apiSend } from '@/lib/api';
import { isLocale } from '@/lib/i18n';
import type { FieldDef, Label, ProjectConfig } from '@/lib/types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LANGS = ['fr', 'en', 'ar'] as const;
const LEVELS = ['impact', 'outcome', 'output'] as const;
const KEY = /^[a-z][a-z0-9_]{1,30}$/;

function ctx(fd: FormData) {
  const locale = String(fd.get('locale') ?? ''), project = String(fd.get('project') ?? '');
  if (!isLocale(locale) || !UUID.test(project)) redirect('/fr/settings');
  return { locale, project, version: Number(fd.get('version') ?? 0) };
}
const done = (c: { locale: string; project: string }, msg: string): never => redirect(`/${c.locale}/settings?project=${c.project}&msg=${msg}`);
const outcome = (r: { ok: boolean; status: number; data: any }) =>
  r.ok ? 'saved' : r.status === 403 ? 'forbidden' : r.status === 409 ? (r.data?.error === 'field_in_use' ? 'in_use' : 'conflict') : 'invalid';
const label = (fd: FormData, prefix: string): Label => {
  const out: Label = {};
  for (const l of LANGS) { const v = String(fd.get(`${prefix}_${l}`) ?? '').trim(); if (v) out[l] = v.slice(0, 200); }
  return out;
};

export async function applyTemplate(fd: FormData) {
  const c = ctx(fd);
  done(c, outcome(await apiSend('POST', `/projects/${c.project}/config/apply-template`, { template: String(fd.get('template') ?? ''), expected_version: c.version })));
}

export async function saveGeneral(fd: FormData) {
  const c = ctx(fd);
  const modules: Record<string, boolean> = {};
  for (const k of String(fd.get('module_keys') ?? '').split(',').filter(Boolean)) modules[k] = fd.get(`mod_${k}`) === 'on';
  const widgets = String(fd.get('widget_ids') ?? '').split(',').filter(Boolean)
    .map((id) => ({ id, order: Number(fd.get(`w_${id}_order`) ?? 0), visible: fd.get(`w_${id}_visible`) === 'on' }))
    .sort((a, b) => a.order - b.order).map(({ id, visible }) => ({ id, visible }));
  const level_labels: Record<string, Label> = {};
  for (const lv of LEVELS) { const l = label(fd, `lv_${lv}`); if (Object.keys(l).length) level_labels[lv] = l; }
  done(c, outcome(await apiSend('PUT', `/projects/${c.project}/config`, { expected_version: c.version, modules, dashboard: { widgets }, terminology: { level_labels } })));
}

export async function addField(fd: FormData) {
  const c = ctx(fd);
  const key = String(fd.get('key') ?? '').trim(), type = String(fd.get('type') ?? '') as FieldDef['type'];
  if (!KEY.test(key) || !['text', 'number', 'select', 'date', 'boolean'].includes(type)) return done(c, 'invalid');
  const lab = label(fd, 'label');
  if (!Object.keys(lab).length) return done(c, 'invalid');
  const field: FieldDef = { key, type, label: lab, required: fd.get('required') === 'on' };
  if (type === 'select') {
    field.options = String(fd.get('options') ?? '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 50).map((line) => {
      const [value, fr, en, ar] = line.split('|').map((x) => x.trim());
      const lb: Label = {}; if (fr) lb.fr = fr; if (en) lb.en = en; if (ar) lb.ar = ar;
      return { value: value ?? '', label: Object.keys(lb).length ? lb : { fr: value ?? '' } };
    });
  }
  const cur = await apiGet<ProjectConfig>(`/projects/${c.project}/config`);
  if (!cur.ok) return done(c, 'invalid');
  done(c, outcome(await apiSend('PUT', `/projects/${c.project}/config`, { expected_version: c.version, custom_fields: [...cur.data.custom_fields, field] })));
}

export async function removeField(fd: FormData) {
  const c = ctx(fd);
  const key = String(fd.get('key') ?? '');
  const cur = await apiGet<ProjectConfig>(`/projects/${c.project}/config`);
  if (!cur.ok) return done(c, 'invalid');
  done(c, outcome(await apiSend('PUT', `/projects/${c.project}/config`, { expected_version: c.version, custom_fields: cur.data.custom_fields.filter((f) => f.key !== key) })));
}
