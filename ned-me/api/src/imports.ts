import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type pg from 'pg';
import ExcelJS from 'exceljs';
import { withTenant } from './db.ts';

/**
 * Import en lot de valeurs d'indicateurs (CSV ou XLSX). Deux temps : aperçu (aucune écriture, chaque ligne jugée) puis validation
 * « tout ou rien » : une seule ligne en erreur et rien n'est écrit. Les valeurs entrent en BROUILLON : elles suivent ensuite
 * le workflow normal (soumission, revue, validation…) — un import ne contourne jamais la validation.
 *
 * Colonnes : indicator_code, period, period_end (AAAA-MM-JJ), kind (target|actual), value, comment (facultatif), dim_<nom> (ventilations, facultatif).
 */
export const MAX_ROWS = 5000;
export interface RawRow { line: number; cells: Record<string, string> }
export interface RowResult { line: number; ok: boolean; errors: string[]; row?: { indicator_code: string; period: string; period_end: string; kind: 'target' | 'actual'; value: number; dimensions: Record<string, string>; comment: string | null } }

/** CSV RFC 4180 minimal : guillemets, guillemets doublés, retours à la ligne dans un champ, BOM, séparateur « , » ou « ; » détecté sur l'en-tête. */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, '');
  const head = t.split(/\r?\n/, 1)[0] ?? '';
  const delim = (head.match(/;/g)?.length ?? 0) > (head.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = []; let row: string[] = [], cur = '', q = false, any = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; continue; }
    if (ch === '"') { q = true; any = true; }
    else if (ch === delim) { row.push(cur); cur = ''; any = true; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; if (any || cur !== '') { row.push(cur); rows.push(row); } row = []; cur = ''; any = false; }
    else { cur += ch; any = true; }
  }
  if (q) throw new Error('csv: guillemet non fermé');
  if (any || cur !== '') { row.push(cur); rows.push(row); }
  return rows;
}

export async function parseXlsx(base64: string): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(base64, 'base64') as never);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('xlsx: aucune feuille');
  const out: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (r) => {
    const cells: string[] = [];
    r.eachCell({ includeEmpty: true }, (c, n) => {
      let v: any = c.value;
      if (v && typeof v === 'object' && 'result' in v) v = v.result;                  // formule : on lit le résultat calculé
      if (v && typeof v === 'object' && 'text' in v) v = v.text;                       // lien / texte riche
      if (v instanceof Date) v = v.toISOString().slice(0, 10);
      cells[n - 1] = v == null ? '' : String(v);
    });
    out.push(Array.from(cells, (x) => x ?? ''));
  });
  return out;
}

export function toRawRows(table: string[][]): RawRow[] {
  if (table.length === 0) throw new Error('fichier vide');
  const header = table[0].map((h) => h.trim().toLowerCase());
  const required = ['indicator_code', 'period', 'period_end', 'kind', 'value'];
  const missing = required.filter((c) => !header.includes(c));
  if (missing.length) throw new Error(`colonnes manquantes : ${missing.join(', ')}`);
  const dup = header.find((h, i) => h && header.indexOf(h) !== i);
  if (dup) throw new Error(`colonne en double : ${dup}`);
  const body = table.slice(1).filter((r) => r.some((c) => c.trim() !== ''));
  if (body.length > MAX_ROWS) throw new Error(`trop de lignes (${body.length} > ${MAX_ROWS})`);
  return body.map((r, i) => ({ line: i + 2, cells: Object.fromEntries(header.map((h, j) => [h, (r[j] ?? '').trim()])) }));
}

const isRealDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
/** « 96,5 » → 96.5 ; « 1 234,5 » et « 1,234.5 » acceptés ; tout le reste (texte, vide, infini) est refusé : jamais de valeur devinée. */
export function parseNumber(s: string): number | null {
  let x = s.replace(/[\s  ]/g, '');
  if (!x) return null;
  if (x.includes(',') && x.includes('.')) x = x.lastIndexOf(',') > x.lastIndexOf('.') ? x.replace(/\./g, '').replace(',', '.') : x.replace(/,/g, '');
  else if (x.includes(',')) x = x.replace(',', '.');
  if (!/^[+-]?\d+(\.\d+)?$/.test(x)) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

/** Jugement ligne à ligne (pur : testable sans base). `known` = codes d'indicateurs du projet ; `existing` = clés déjà en base. */
export function judge(rows: RawRow[], known: Set<string>, existing: Set<string>): RowResult[] {
  const seen = new Set<string>();
  return rows.map(({ line, cells }) => {
    const errors: string[] = [];
    const code = cells.indicator_code ?? '', period = cells.period ?? '', end = cells.period_end ?? '', kind = (cells.kind ?? '').toLowerCase();
    if (!known.has(code)) errors.push(`indicateur inconnu dans ce projet : « ${code} »`);
    if (period.length < 4 || period.length > 40) errors.push('période : 4 à 40 caractères');
    if (!isRealDate(end)) errors.push('period_end : date réelle AAAA-MM-JJ');
    if (kind !== 'target' && kind !== 'actual') errors.push('kind : target ou actual');
    const value = parseNumber(cells.value ?? '');
    if (value == null) errors.push('value : nombre attendu');
    const dimensions: Record<string, string> = {};
    for (const [k, v] of Object.entries(cells)) if (k.startsWith('dim_') && v !== '') {
      if (!/^dim_[a-z0-9_]{1,30}$/.test(k)) errors.push(`colonne de ventilation invalide : ${k}`);
      else dimensions[k.slice(4)] = v.slice(0, 100);
    }
    const comment = cells.comment ? cells.comment.slice(0, 1000) : null;
    if (errors.length === 0) {
      const key = keyOf(code, period, kind, dimensions);
      if (seen.has(key)) errors.push('doublon dans le fichier (même indicateur, période, nature et ventilation)');
      else if (existing.has(key)) errors.push('une valeur existe déjà en base pour cette clé (aucun écrasement)');
      seen.add(key);
    }
    return errors.length ? { line, ok: false, errors } : { line, ok: true, errors, row: { indicator_code: code, period, period_end: end, kind: kind as 'target' | 'actual', value: value!, dimensions, comment } };
  });
}
export const keyOf = (code: string, period: string, kind: string, dims: Record<string, string>) =>
  JSON.stringify([code, period, kind, Object.entries(dims).sort(([a], [b]) => a.localeCompare(b))]);

/** Jugement d'un lot de lignes brutes contre le projet : même chemin pour un fichier, un connecteur ou toute future source. */
export async function analyseRows(c: pg.PoolClient, projectId: string, raw: RawRow[]) {
  const inds = (await c.query('SELECT id, code FROM indicator WHERE project_id = $1', [projectId])).rows as { id: string; code: string }[];
  const idByCode = new Map(inds.map((i) => [i.code, i.id]));
  const ex = (await c.query(`SELECT i.code, v.period, v.kind, v.dimensions FROM indicator_value v JOIN indicator i ON i.tenant_id = v.tenant_id AND i.id = v.indicator_id WHERE i.project_id = $1`, [projectId])).rows;
  const existing = new Set(ex.map((r) => keyOf(r.code, r.period, r.kind, r.dimensions)));
  return { results: judge(raw, new Set(idByCode.keys()), existing), idByCode };
}
/** Écriture des lignes jugées valides, TOUJOURS en brouillon : aucune source n'entre dans le workflow au-delà de « draft ». */
export async function insertDrafts(c: pg.PoolClient, idByCode: Map<string, string>, results: RowResult[], source: string) {
  await c.query("SELECT set_config('app.comment', $1, true)", [source]);
  for (const r of results) {
    const x = r.row!;
    await c.query(`INSERT INTO indicator_value (tenant_id, indicator_id, period, period_end, kind, value, dimensions, comment) VALUES (app.current_tenant(), $1,$2,$3,$4,$5,$6,$7)`,
      [idByCode.get(x.indicator_code), x.period, x.period_end, x.kind, x.value, x.dimensions, x.comment]);
  }
}

const Body = z.object({ project_id: z.guid(), format: z.enum(['csv', 'xlsx']), content: z.string().min(1).max(7_000_000) }).strict();
const ROLES = ['admin', 'me_manager', 'data_entry'];

export function registerImports(app: FastifyInstance, pool: pg.Pool) {
  async function analyse(c: pg.PoolClient, b: z.infer<typeof Body>) {
    const table = b.format === 'csv' ? parseCsv(b.content) : await parseXlsx(b.content);
    return analyseRows(c, b.project_id, toRawRows(table));
  }
  const guard = async (req: any, reply: any) => { if (!req.principal.roles.some((r: string) => ROLES.includes(r))) return reply.code(403).send({ error: 'forbidden' }); };
  const fail = (reply: any, e: unknown) => reply.code(400).send({ error: 'import_format', message: (e as Error).message });
  const cfg = { bodyLimit: 8_000_000, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };

  app.post('/imports/indicator-values/preview', { preHandler: guard, ...cfg }, async (req, reply) => {
    const b = Body.parse(req.body);
    try {
      return await withTenant(pool, (req as any).principal, async (c) => {
        if ((await c.query('SELECT 1 FROM project WHERE id = $1', [b.project_id])).rowCount !== 1) return reply.code(404).send({ error: 'not_found' });
        const { results } = await analyse(c, b);
        return { total: results.length, ok: results.filter((r) => r.ok).length, errors: results.filter((r) => !r.ok).length, rows: results.slice(0, 500).map((r) => ({ line: r.line, ok: r.ok, errors: r.errors, row: r.row })), truncated: results.length > 500 };
      });
    } catch (e) { if ((e as any)?.code || (e as any)?.name === 'ZodError') throw e; return fail(reply, e); }
  });

  app.post('/imports/indicator-values/commit', { preHandler: guard, ...cfg }, async (req, reply) => {
    const b = Body.parse(req.body);
    try {
      return await withTenant(pool, (req as any).principal, async (c) => {
        if ((await c.query('SELECT 1 FROM project WHERE id = $1', [b.project_id])).rowCount !== 1) return reply.code(404).send({ error: 'not_found' });
        const { results, idByCode } = await analyse(c, b);
        const bad = results.filter((r) => !r.ok).length;
        if (bad) return reply.code(422).send({ error: 'import_has_errors', errors: bad });          // tout ou rien
        await insertDrafts(c, idByCode, results, 'import');
        return reply.code(201).send({ inserted: results.length, state: 'draft' });
      });
    } catch (e) { if ((e as any)?.code || (e as any)?.name === 'ZodError') throw e; return fail(reply, e); }
  });
}
