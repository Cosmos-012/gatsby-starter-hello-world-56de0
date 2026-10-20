'use server';
import { redirect } from 'next/navigation';
import { apiSend } from '@/lib/api';
import { isLocale } from '@/lib/i18n';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATES = ['draft', 'submitted', 'review', 'validated', 'approved', 'published', 'archived'];

function ctx(fd: FormData) {
  const locale = String(fd.get('locale') ?? ''), id = String(fd.get('id') ?? '');
  if (!isLocale(locale) || !UUID.test(id)) redirect('/fr/indicators');
  return { locale, id };
}
const back = (c: { locale: string; id: string }, msg: string): never => redirect(`/${c.locale}/indicators/${c.id}?msg=${msg}`);
const errMsg = (status: number) => (status === 403 ? 'forbidden' : status === 409 ? 'duplicate' : 'invalid');

export async function addValue(fd: FormData) {
  const c = ctx(fd);
  const value = Number(String(fd.get('value') ?? '').replace(',', '.'));
  const kind = String(fd.get('kind') ?? ''), period = String(fd.get('period') ?? '').trim(), period_end = String(fd.get('period_end') ?? '');
  if (!Number.isFinite(value) || String(fd.get('value') ?? '').trim() === '' || !['target', 'actual'].includes(kind) || period.length < 4 || !/^\d{4}-\d{2}-\d{2}$/.test(period_end)) return back(c, 'invalid');
  const comment = String(fd.get('comment') ?? '').trim();
  const r = await apiSend('POST', '/indicator-values', { indicator_id: c.id, period, period_end, kind, value, ...(comment ? { comment: comment.slice(0, 1000) } : {}) });
  back(c, r.ok ? 'saved' : errMsg(r.status));
}

export async function moveValue(fd: FormData) {
  const c = ctx(fd);
  const valueId = String(fd.get('value_id') ?? ''), to = String(fd.get('to') ?? '');
  if (!UUID.test(valueId) || !STATES.includes(to)) return back(c, 'invalid');
  const r = await apiSend('POST', `/indicator-values/${valueId}/transition`, { to });
  back(c, r.ok ? 'moved' : r.status === 403 ? 'forbidden' : r.status === 409 ? 'conflict' : 'invalid');
}
