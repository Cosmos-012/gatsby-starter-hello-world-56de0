'use server';
import { apiSend } from '@/lib/api';
import { isLocale } from '@/lib/i18n';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID = /^[a-z][a-z0-9_-]{1,30}$/;

export interface RunRow { line: number; ok: boolean; errors: string[]; row?: { indicator_code: string; period: string; kind: string; value: number } }
export interface RunState { status?: 'ok' | 'has_errors' | 'failed'; inserted?: number; skipped?: number; errors?: number; rows?: RunRow[]; reason?: string; message?: string }

/** Lance un connecteur. Les valeurs du formulaire (dont le jeton) vont de ce serveur à l'API le temps de l'appel : rien n'est renvoyé au navigateur ni conservé. */
export async function runIntegration(_prev: RunState, fd: FormData): Promise<RunState> {
  const locale = String(fd.get('locale') ?? ''), project = String(fd.get('project') ?? ''), id = String(fd.get('connector') ?? '');
  if (!isLocale(locale) || !UUID.test(project) || !ID.test(id)) return { status: 'failed', reason: 'invalid_config' };
  const values: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith('f:') && typeof v === 'string') values[k.slice(2)] = v;
  const r = await apiSend<RunState>('POST', `/integrations/${id}/run`, { project_id: project, values, skip_existing: fd.get('skip_existing') === 'on' });
  if (r.status === 403) return { status: 'failed', reason: 'forbidden' };
  if (r.data && r.data.status) return r.data;
  return { status: 'failed', reason: 'api' };
}
