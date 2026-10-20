import type pg from 'pg';
import { z } from 'zod';
import { withTenant } from '../db.ts';
import type { Principal } from '../auth.ts';
import { analyseRows, insertDrafts, MAX_ROWS, type RawRow, type RowResult } from '../imports.ts';

/**
 * POINT D'EXTENSION DES INTÉGRATIONS (Kobo/ODK, DHIS2, tableurs en ligne, ERP…).
 *
 * Un connecteur sait UNE chose : transformer une source externe en lignes brutes au format de l'import
 * (indicator_code, period, period_end, kind, value, comment, dim_*). Tout le reste est commun et déjà testé :
 * jugement ligne à ligne, refus des doublons et des écrasements, « tout ou rien », entrée en BROUILLON uniquement,
 * puis workflow normal (soumission, revue, validation, approbation) avec séparation des tâches. Un connecteur ne
 * peut donc ni valider une valeur, ni écraser l'existant, ni sortir du client (tenant) de l'appelant.
 *
 * Ajouter une intégration = écrire un objet `Connector` et l'enregistrer (voir docs/INTEGRATIONS.md).
 */
export type Label = { fr?: string; en?: string; ar?: string };
/** Description d'un champ du formulaire d'exécution : l'interface se construit à partir de ces descriptions, sans code propre au connecteur. */
export interface FormField {
  /** Chemin dans la configuration, pointé pour l'imbrication (« mapping.value »). */
  name: string; label: Label; type: 'text' | 'url' | 'password' | 'select' | 'date' | 'textarea'; required?: boolean;
  options?: { value: string; label: Label }[]; hint?: Label; placeholder?: string;
}
export interface Connector<C = unknown> {
  /** Identifiant stable, minuscules : sert de source dans le journal (« connector:<id> »). */
  id: string;
  /** Libellés affichés dans l'interface (au moins une langue). */
  label: Label;
  /** Description courte, affichée sous le nom. */
  description?: Label;
  /** Formulaire d'exécution (champs, libellés, secrets en `password` : jamais renvoyés ni conservés). */
  form: FormField[];
  /** Forme de la configuration (URL, jeton, formulaire…) : validée avant tout appel externe. */
  config: z.ZodType<C>;
  /** Lit la source et rend des lignes brutes. Doit lever une erreur claire plutôt que rendre des lignes devinées. */
  pull(config: C, ctx: { projectId: string; signal: AbortSignal }): Promise<RawRow[]>;
}

const registry = new Map<string, Connector<any>>();
export function registerConnector<C>(c: Connector<C>): void {
  if (!/^[a-z][a-z0-9_-]{1,30}$/.test(c.id)) throw new Error(`identifiant de connecteur invalide : ${c.id}`);
  if (registry.has(c.id)) throw new Error(`connecteur déjà enregistré : ${c.id}`);
  registry.set(c.id, c);
}
export const listConnectors = () => [...registry.values()].map(({ id, label, description, form }) => ({ id, label, description, form }));
export const getConnector = (id: string) => registry.get(id);

export type RunOutcome =
  | { status: 'ok'; inserted: number; skipped: number }
  | { status: 'has_errors'; errors: number; rows: RowResult[] }
  | { status: 'failed'; reason: 'unknown_connector' | 'invalid_config' | 'pull_failed' | 'too_many_rows' | 'unknown_project'; message?: string };

/** Exécute un connecteur pour un projet : lecture → jugement → écriture en brouillon, tout ou rien, dans la transaction du client. */
export async function runConnector(pool: pg.Pool, who: Principal, connectorId: string, rawConfig: unknown, projectId: string, opts: { timeoutMs?: number; skipExisting?: boolean } = {}): Promise<RunOutcome> {
  const conn = registry.get(connectorId);
  if (!conn) return { status: 'failed', reason: 'unknown_connector' };
  const cfg = conn.config.safeParse(rawConfig);
  if (!cfg.success) return { status: 'failed', reason: 'invalid_config', message: cfg.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ') };
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 30_000);
  let raw: RawRow[];
  try { raw = await conn.pull(cfg.data, { projectId, signal: ctl.signal }); }
  catch (e) { return { status: 'failed', reason: 'pull_failed', message: (e as Error).message }; }
  finally { clearTimeout(timer); }
  if (raw.length > MAX_ROWS) return { status: 'failed', reason: 'too_many_rows' };
  return withTenant(pool, who, async (c: pg.PoolClient): Promise<RunOutcome> => {
    if ((await c.query('SELECT 1 FROM project WHERE id = $1', [projectId])).rowCount !== 1) return { status: 'failed', reason: 'unknown_project' };
    const { results, idByCode } = await analyseRows(c, projectId, raw);
    // Rejouer une synchronisation : les valeurs déjà importées peuvent être ignorées (jamais écrasées) si l'appelant le demande.
    const skipped = opts.skipExisting ? results.filter((r) => r.exists && r.errors.length === 1) : [];
    const todo = results.filter((r) => !skipped.includes(r));
    const bad = todo.filter((r) => !r.ok);
    if (bad.length) return { status: 'has_errors', errors: bad.length, rows: todo.slice(0, 500) };
    await insertDrafts(c, idByCode, todo, `connector:${conn.id}`);
    return { status: 'ok', inserted: todo.length, skipped: skipped.length };
  });
}
