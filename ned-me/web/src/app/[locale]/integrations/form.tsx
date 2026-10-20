'use client';
import { useActionState } from 'react';
import { Plug, Play, CircleCheck, CircleAlert, CircleX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { runIntegration, type RunState } from './actions';

export interface Field { name: string; label: string; type: string; required?: boolean; hint?: string; placeholder?: string; options?: { value: string; label: string }[] }
export interface Labels { run: string; running: string; skipExisting: string; skipHint: string; secret: string; line: string; status: string; ok: string; error: string;
  okDone: string; hasErrors: string; reasons: Record<string, string> }
const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));

export function ConnectorCard({ locale, project, id, title, description, fields, labels }: { locale: string; project: string; id: string; title: string; description?: string; fields: Field[]; labels: Labels }) {
  const [res, action, pending] = useActionState<RunState, FormData>(runIntegration, {});
  return (
    <Card data-testid={`connector-${id}`}>
      <CardHeader>
        <div className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-md bg-accent text-accent-foreground"><Plug className="size-4" aria-hidden="true" /></span><CardTitle>{title}</CardTitle></div>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <form action={action}>
        <input type="hidden" name="locale" value={locale} /><input type="hidden" name="project" value={project} /><input type="hidden" name="connector" value={id} />
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {fields.map((f) => {
            const fid = `${id}-${f.name}`;
            const common = { id: fid, name: `f:${f.name}`, required: f.required, placeholder: f.placeholder, 'aria-describedby': f.hint ? `${fid}-h` : undefined };
            return (
              <div key={f.name} className={f.type === 'textarea' ? 'space-y-1.5 sm:col-span-2' : 'space-y-1.5'}>
                <Label htmlFor={fid}>{f.label}{f.required && <span aria-hidden="true"> *</span>}</Label>
                {f.type === 'select' ? <Select {...common}>{f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
                  : f.type === 'textarea' ? <Textarea {...common} dir="ltr" spellCheck={false} />
                  : f.type === 'password' ? <Input {...common} type="password" autoComplete="off" dir="ltr" data-testid={`field-${f.name}`} />
                  : <Input {...common} type={f.type === 'url' ? 'url' : f.type === 'date' ? 'date' : 'text'} dir="ltr" data-testid={`field-${f.name}`} />}
                {f.type === 'password' && <p className="text-xs text-muted-foreground">{labels.secret}</p>}
                {f.hint && <p id={`${fid}-h`} className="text-xs text-muted-foreground">{f.hint}</p>}
              </div>
            );
          })}
          <div className="flex items-start gap-3 sm:col-span-2">
            <Switch name="skip_existing" id={`${id}-skip`} />
            <div><Label htmlFor={`${id}-skip`}>{labels.skipExisting}</Label><p className="text-xs text-muted-foreground">{labels.skipHint}</p></div>
          </div>
        </CardContent>
        <CardFooter><Button type="submit" disabled={pending} data-testid="run-connector"><Play aria-hidden="true" />{pending ? labels.running : labels.run}</Button></CardFooter>
      </form>
      <div aria-live="polite" className="px-5 pb-5">
        {res.status === 'ok' && <p role="status" data-testid="run-ok" className="flex items-center gap-2 rounded-md border border-good/40 bg-good/10 px-3 py-2 text-sm text-good-ink"><CircleCheck className="size-4" aria-hidden="true" />{fill(labels.okDone, { n: res.inserted ?? 0, s: res.skipped ?? 0 })}</p>}
        {res.status === 'failed' && <p role="alert" data-testid="run-failed" className="flex items-center gap-2 rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-critical-ink"><CircleX className="size-4" aria-hidden="true" />{fill(labels.reasons[res.reason ?? 'api'] ?? labels.reasons.api, { detail: res.message ?? '' })}</p>}
        {res.status === 'has_errors' && (
          <div className="space-y-2" data-testid="run-errors">
            <p role="alert" className="flex items-center gap-2 text-sm font-medium text-warning-ink"><CircleAlert className="size-4" aria-hidden="true" />{fill(labels.hasErrors, { n: res.errors ?? 0 })}</p>
            <div className="max-h-72 overflow-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted text-muted-foreground"><tr><th scope="col" className="px-2 py-1 text-start font-medium">{labels.line}</th><th scope="col" className="px-2 py-1 text-start font-medium">{labels.status}</th><th scope="col" className="px-2 py-1 text-start font-medium">—</th></tr></thead>
                <tbody>{res.rows?.filter((r) => !r.ok).map((r) => (
                  <tr key={r.line} className="border-t border-border align-top"><td className="num px-2 py-1">{r.line}</td><td className="px-2 py-1 whitespace-nowrap">✕ {labels.error}</td><td className="px-2 py-1">{r.errors.join(' ; ')}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
