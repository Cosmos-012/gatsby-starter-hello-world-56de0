'use server';
import { redirect } from 'next/navigation';
import { apiSend } from '@/lib/api';
import { isLocale } from '@/lib/i18n';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX = 5 * 1024 * 1024;

export interface PreviewRow { line: number; ok: boolean; errors: string[]; row?: { indicator_code: string; period: string; period_end: string; kind: string; value: number } }
export interface PreviewState { error?: string; detail?: string; done?: number; project?: string; format?: 'csv' | 'xlsx'; content?: string;
  preview?: { total: number; ok: number; errors: number; rows: PreviewRow[]; truncated: boolean } }

function parse(fd: FormData) {
  const locale = String(fd.get('locale') ?? ''), project = String(fd.get('project') ?? '');
  if (!isLocale(locale) || !UUID.test(project)) redirect('/fr/import');
  return { locale, project };
}
const fail = (status: number, data: any): PreviewState =>
  ({ error: status === 403 ? 'forbidden' : status === 422 ? 'errors' : data?.error === 'import_format' ? 'format' : 'api', detail: data?.message });

/** Contrôle sans écriture : lit le fichier, le renvoie au serveur d'API et rend le jugement ligne par ligne. */
export async function previewImport(_prev: PreviewState, fd: FormData): Promise<PreviewState> {
  const { project } = parse(fd);
  const file = fd.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'nofile', project };
  if (file.size > MAX) return { error: 'too_big', project };
  const format = file.name.toLowerCase().endsWith('.xlsx') ? 'xlsx' : file.name.toLowerCase().endsWith('.csv') ? 'csv' : null;
  if (!format) return { error: 'nofile', project };
  const buf = Buffer.from(await file.arrayBuffer());
  const content = format === 'xlsx' ? buf.toString('base64') : buf.toString('utf8');
  const r = await apiSend<any>('POST', '/imports/indicator-values/preview', { project_id: project, format, content });
  if (!r.ok) return { ...fail(r.status, r.data), project };
  return { project, format, content, preview: r.data };
}

/** Validation : renvoie le MÊME contenu ; l'API re-contrôle tout (rien n'est cru du navigateur) et écrit tout ou rien. */
export async function commitImport(_prev: PreviewState, fd: FormData): Promise<PreviewState> {
  const { project } = parse(fd);
  const format = fd.get('format') === 'xlsx' ? 'xlsx' : 'csv', content = String(fd.get('content') ?? '');
  const r = await apiSend<any>('POST', '/imports/indicator-values/commit', { project_id: project, format, content });
  if (!r.ok) return { ...fail(r.status, r.data), project };
  return { project, done: r.data.inserted };
}
