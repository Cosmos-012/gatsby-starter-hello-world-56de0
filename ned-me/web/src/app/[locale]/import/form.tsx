'use client';
import { useActionState } from 'react';
import { commitImport, previewImport, type PreviewState } from './actions';

export interface Labels { file: string; preview: string; commit: string; total: string; allOrNothing: string; truncated: string; line: string; status: string; ok: string; error: string;
  done: string; msg: Record<string, string>; template: string; errorsMsg: string }
const input = 'rounded-md border bg-transparent px-2 py-1.5';
const bd = { borderColor: 'var(--border)' };

export function ImportForm({ locale, project, labels }: { locale: string; project: string; labels: Labels }) {
  const [pv, previewAction, pvPending] = useActionState<PreviewState, FormData>(previewImport, {});
  const [cm, commitAction, cmPending] = useActionState<PreviewState, FormData>(commitImport, {});
  const state = cm.done !== undefined || cm.error ? cm : pv;
  const p = pv.preview;
  const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));
  return (
    <div className="space-y-6">
      <form action={previewAction} className="card flex flex-wrap items-end gap-4" data-testid="form-preview">
        <input type="hidden" name="locale" value={locale} /><input type="hidden" name="project" value={project} />
        <label className="flex flex-col gap-1 text-sm"><span className="secondary">{labels.file}</span>
          <input type="file" name="file" accept=".csv,.xlsx" required className={input} style={bd} /></label>
        <button type="submit" disabled={pvPending} className="rounded-md px-4 py-1.5 text-sm font-medium text-white" style={{ background: 'var(--bar)' }}>{labels.preview}</button>
      </form>

      {state.error && <p role="alert" className="card sev-critical" data-testid="imp-error">{fill(labels.msg[state.error] ?? labels.msg.api, { detail: state.detail ?? '' })}</p>}
      {cm.done !== undefined && <p role="status" className="card" data-testid="imp-done">{fill(labels.done, { n: cm.done })}</p>}

      {p && cm.done === undefined && (
        <section className="card space-y-3" data-testid="imp-preview">
          <p className="font-semibold" data-testid="imp-summary">{fill(labels.total, { total: p.total, ok: p.ok, errors: p.errors })}</p>
          <p className="text-xs muted">{labels.allOrNothing}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="secondary"><th scope="col" className="px-2 py-1 text-start font-medium">{labels.line}</th><th scope="col" className="px-2 py-1 text-start font-medium">{labels.status}</th><th scope="col" className="px-2 py-1 text-start font-medium">—</th></tr></thead>
              <tbody>
                {p.rows.map((r) => (
                  <tr key={r.line} className="border-t align-top" style={bd} data-testid={`imp-line-${r.line}`}>
                    <td className="num px-2 py-1">{r.line}</td>
                    <td className="px-2 py-1 whitespace-nowrap"><span aria-hidden="true">{r.ok ? '✓' : '✕'}</span> <span className={r.ok ? '' : 'sev-critical font-semibold'}>{r.ok ? labels.ok : labels.error}</span></td>
                    <td className="px-2 py-1">{r.ok ? `${r.row!.indicator_code} · ${r.row!.period} · ${r.row!.kind} · ${r.row!.value}` : r.errors.join(' ; ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {p.truncated && <p className="text-xs muted">{labels.truncated}</p>}
          {p.errors === 0 && p.ok > 0 && (
            <form action={commitAction} data-testid="form-commit">
              <input type="hidden" name="locale" value={locale} /><input type="hidden" name="project" value={project} />
              <input type="hidden" name="format" value={pv.format} /><input type="hidden" name="content" value={pv.content} />
              <button type="submit" disabled={cmPending} className="rounded-md px-4 py-2 text-sm font-medium text-white" style={{ background: 'var(--bar)' }}>{fill(labels.commit, { n: p.ok })}</button>
            </form>
          )}
        </section>
      )}
    </div>
  );
}
