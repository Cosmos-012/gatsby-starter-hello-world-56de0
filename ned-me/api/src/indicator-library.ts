import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type pg from 'pg';
import { withTenant } from './db.ts';

const Uuid = z.guid();
const Label = z.object({ fr: z.string().min(1).max(300).optional(), ar: z.string().min(1).max(300).optional(), en: z.string().min(1).max(300).optional() })
  .refine((n) => n.fr || n.ar || n.en, 'au moins une langue');
const WRITE = ['admin', 'me_manager'];
const READ = [...WRITE, 'data_entry', 'reviewer', 'viewer'];

export const DEF = z.object({
  code: z.string().regex(/^[A-Za-z0-9._-]{1,40}$/), title: Label, definition: Label.optional(), unit: z.string().max(60).optional(),
  type: z.enum(['number', 'percentage', 'ratio', 'index', 'boolean']).default('number'), direction: z.enum(['increase', 'decrease']).default('increase'),
  aggregation: z.enum(['sum', 'avg', 'latest', 'ratio']).default('latest'), frequency: z.enum(['monthly', 'quarterly', 'semiannual', 'annual']).default('quarterly'),
  numerator_def: z.string().max(500).optional(), denominator_def: z.string().max(500).optional(),
  disaggregations: z.array(z.string().regex(/^[a-z0-9_]{1,30}$/)).max(20).default([]),
  sdg_target: z.string().regex(/^[0-9]{1,2}\.[0-9a-z]{1,2}(\.[0-9a-z]{1,2})?$/).optional(), iati_code: z.string().min(1).max(60).optional(),
  data_source: z.string().max(500).optional(), collection_method: z.string().max(500).optional(),
}).strict().refine((d) => d.type !== 'ratio' || (d.numerator_def && d.denominator_def), { message: 'un ratio exige numerator_def et denominator_def', path: ['type'] });

const COLS = 'id, code, title, definition, unit, type, direction, aggregation, frequency, numerator_def, denominator_def, disaggregations, sdg_target, iati_code, data_source, collection_method, status';

/** Charge une fiche active ; null si absente ou retirée (un indicateur ne se crée pas depuis une fiche retirée). */
export async function activeDefinition(c: pg.PoolClient, id: string) {
  return (await c.query(`SELECT ${COLS} FROM indicator_definition WHERE id = $1 AND status = 'active'`, [id])).rows[0] ?? null;
}

export function registerIndicatorLibrary(app: FastifyInstance, pool: pg.Pool) {
  const guard = (roles: string[]) => async (req: any, reply: any) => { if (!req.principal.roles.some((r: string) => roles.includes(r))) return reply.code(403).send({ error: 'forbidden' }); };

  app.post('/indicator-definitions', { preHandler: guard(WRITE) }, async (req, reply) => {
    const d = DEF.parse(req.body);
    const row = await withTenant(pool, (req as any).principal, async (c) => (await c.query(
      `INSERT INTO indicator_definition (tenant_id, code, title, definition, unit, type, direction, aggregation, frequency, numerator_def, denominator_def, disaggregations, sdg_target, iati_code, data_source, collection_method)
       VALUES (app.current_tenant(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING ${COLS}`,
      [d.code, d.title, d.definition ?? null, d.unit ?? null, d.type, d.direction, d.aggregation, d.frequency, d.numerator_def ?? null, d.denominator_def ?? null,
       d.disaggregations, d.sdg_target ?? null, d.iati_code ?? null, d.data_source ?? null, d.collection_method ?? null])).rows[0]);
    return reply.code(201).send(row);
  });

  app.get('/indicator-definitions', { preHandler: guard(READ) }, async (req) => {
    const f = z.object({ search: z.string().max(100).optional(), status: z.enum(['active', 'retired']).optional(), sdg: z.string().max(20).optional() }).parse(req.query);
    return withTenant(pool, (req as any).principal, async (c) => (await c.query(
      `SELECT ${COLS}, (SELECT count(*)::int FROM indicator i WHERE i.definition_id = d.id) AS used_by
       FROM indicator_definition d
       WHERE ($1::text IS NULL OR app.search_text(title) LIKE '%' || app.norm_text($1) || '%' OR lower(code) LIKE '%' || lower($1) || '%')
         AND ($2::text IS NULL OR status = $2) AND ($3::text IS NULL OR sdg_target = $3 OR sdg_target LIKE $3 || '.%')
       ORDER BY code LIMIT 300`, [f.search ?? null, f.status ?? null, f.sdg ?? null])).rows);
  });

  app.get('/indicator-definitions/:id', { preHandler: guard(READ) }, async (req, reply) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const row = await withTenant(pool, (req as any).principal, async (c) => (await c.query(`SELECT ${COLS} FROM indicator_definition WHERE id = $1`, [id])).rows[0]);
    return row ?? reply.code(404).send({ error: 'not_found' });
  });

  // Retirer (jamais supprimer) : les indicateurs déjà créés gardent leur lien et leurs valeurs.
  app.post('/indicator-definitions/:id/retire', { preHandler: guard(WRITE) }, async (req, reply) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const n = await withTenant(pool, (req as any).principal, async (c) => (await c.query(`UPDATE indicator_definition SET status = 'retired' WHERE id = $1 AND status = 'active'`, [id])).rowCount);
    return n ? { id, status: 'retired' } : reply.code(404).send({ error: 'not_found' });
  });
}
