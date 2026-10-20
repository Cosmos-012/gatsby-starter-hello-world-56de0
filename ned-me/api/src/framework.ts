import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type pg from 'pg';
import { withTenant } from './db.ts';
import { loadConfig, validateAttributes } from './project-config.ts';
import { nextStates, type State } from './workflow.ts';
import { activeDefinition } from './indicator-library.ts';

const Name = z.object({ fr: z.string().optional(), ar: z.string().optional(), en: z.string().optional() })
  .refine((n) => n.fr || n.ar || n.en, 'at least one language required');
const Uuid = z.guid();
const WRITE = ['admin', 'me_manager'];
const READ = [...WRITE, 'data_entry', 'reviewer', 'viewer'];

/** Phase 2 : organisations, programmes, composantes, cadre de résultats, indicateurs. */
export function registerFramework(app: FastifyInstance, pool: pg.Pool) {
  const guard = (roles: string[]) => async (req: any, reply: any) => {
    if (!req.principal.roles.some((r: string) => roles.includes(r))) return reply.code(403).send({ error: 'forbidden' });
  };
  const q = (req: any, sql: string, params: unknown[]) => withTenant(pool, req.principal, async (c) => (await c.query(sql, params)).rows);

  app.post('/organisations', { preHandler: guard(WRITE) }, async (req, reply) => {
    const b = z.object({ name: z.string().min(1), kind: z.enum(['government', 'pmu', 'piu', 'donor', 'executing', 'ngo', 'consultant', 'other']).default('executing'), parent_id: Uuid.optional() }).parse(req.body);
    const [row] = await q(req, 'INSERT INTO organisation (tenant_id,name,kind,parent_id) VALUES (app.current_tenant(),$1,$2,$3) RETURNING id,name,kind', [b.name, b.kind, b.parent_id ?? null]);
    return reply.code(201).send(row);
  });
  app.get('/organisations', { preHandler: guard(READ) }, async (req) => q(req, 'SELECT id,name,kind,parent_id FROM organisation ORDER BY name', []));

  app.post('/programs', { preHandler: guard(WRITE) }, async (req, reply) => {
    const b = z.object({ code: z.string().min(1), name: Name, owner_org_id: Uuid.optional() }).parse(req.body);
    const [row] = await q(req, 'INSERT INTO program (tenant_id,code,name,owner_org_id) VALUES (app.current_tenant(),$1,$2,$3) RETURNING id,code', [b.code, b.name, b.owner_org_id ?? null]);
    return reply.code(201).send(row);
  });
  app.get('/programs', { preHandler: guard(READ) }, async (req) => q(req, 'SELECT id,code,name FROM program ORDER BY code', []));

  app.post('/projects/:id/components', { preHandler: guard(WRITE) }, async (req, reply) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const b = z.object({ code: z.string().min(1), name: Name }).parse(req.body);
    const [row] = await q(req, 'INSERT INTO component (tenant_id,project_id,code,name) VALUES (app.current_tenant(),$1,$2,$3) RETURNING id,code', [id, b.code, b.name]);
    return reply.code(201).send(row);
  });
  app.get('/projects/:id/components', { preHandler: guard(READ) }, async (req) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    return q(req, 'SELECT id,code,name FROM component WHERE project_id=$1 ORDER BY code', [id]);
  });

  app.post('/projects/:id/results', { preHandler: guard(WRITE) }, async (req, reply) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const b = z.object({ level: z.enum(['impact', 'outcome', 'output', 'activity']), code: z.string().min(1), name: Name,
      parent_id: Uuid.optional(), component_id: Uuid.optional(), assumptions: Name.optional() }).parse(req.body);
    const [row] = await q(req, 'INSERT INTO result (tenant_id,project_id,level,code,name,parent_id,component_id,assumptions) VALUES (app.current_tenant(),$1,$2,$3,$4,$5,$6,$7) RETURNING id,level,code',
      [id, b.level, b.code, b.name, b.parent_id ?? null, b.component_id ?? null, b.assumptions ?? null]);
    return reply.code(201).send(row);
  });
  // Chaîne de résultats en arbre : Impact → Outcome → Output → Activité, avec indicateurs rattachés.
  app.get('/projects/:id/results/tree', { preHandler: guard(READ) }, async (req) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const rows = await q(req, `SELECT r.id, r.parent_id, r.level, r.code, r.name,
        COALESCE((SELECT json_agg(json_build_object('id',i.id,'code',i.code) ORDER BY i.code) FROM indicator i WHERE i.result_id = r.id), '[]') AS indicators
      FROM result r WHERE r.project_id = $1 ORDER BY r.code`, [id]);
    const byId = new Map<string, any>(rows.map((r) => [r.id, { ...r, children: [] as any[] }]));
    const roots: any[] = [];
    for (const n of byId.values()) (n.parent_id && byId.get(n.parent_id) ? byId.get(n.parent_id).children : roots).push(n);
    return roots;
  });

  app.post('/indicators', { preHandler: guard(WRITE) }, async (req, reply) => {
    const b = z.object({
      project_id: Uuid, definition_id: Uuid.optional(), result_id: Uuid.optional(), code: z.string().min(1), name: Name.optional(), definition: Name.optional(),
      unit: z.string().optional(), type: z.enum(['number', 'percentage', 'ratio', 'index', 'boolean']).optional(),
      direction: z.enum(['increase', 'decrease']).optional(),
      frequency: z.enum(['monthly', 'quarterly', 'semiannual', 'annual']).optional(),
      baseline: z.number().finite().optional(), baseline_period: z.string().optional(),
      data_source: z.string().optional(), collection_method: z.string().optional(), responsible_org_id: Uuid.optional(),
      attributes: z.record(z.string(), z.unknown()).default({}),
    }).parse(req.body);
    // Fiche de la bibliothèque : ses champs servent de valeurs par défaut (copie instantanée) ; ce qui est fourni explicitement l'emporte.
    let def: any = null;
    if (b.definition_id) {
      def = await withTenant(pool, (req as any).principal, (c) => activeDefinition(c, b.definition_id!));
      if (!def) return reply.code(409).send({ error: 'definition_unavailable' });
    }
    const name = b.name ?? def?.title;
    if (!name) return reply.code(400).send({ error: 'validation', details: ['name ou definition_id requis'] });
    const x = { definition: b.definition ?? def?.definition ?? null, unit: b.unit ?? def?.unit ?? null, type: b.type ?? def?.type ?? 'number', direction: b.direction ?? def?.direction ?? 'increase',
      frequency: b.frequency ?? def?.frequency ?? 'quarterly', data_source: b.data_source ?? def?.data_source ?? null, collection_method: b.collection_method ?? def?.collection_method ?? null,
      numerator_def: def?.numerator_def ?? null, denominator_def: def?.denominator_def ?? null };
    // Champs personnalisés : validés contre la définition du projet (inconnu, type, liste, requis).
    const cfg = await withTenant(pool, (req as any).principal, (c) => loadConfig(c, b.project_id));
    const bad = validateAttributes(cfg.custom_fields, b.attributes);
    if (bad.length) return reply.code(400).send({ error: 'validation', details: bad });
    const [row] = await q(req, `INSERT INTO indicator (tenant_id,project_id,result_id,code,name,definition,unit,type,direction,frequency,baseline,baseline_period,data_source,collection_method,responsible_org_id,attributes,definition_id,numerator_def,denominator_def)
      VALUES (app.current_tenant(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id,code`,
      [b.project_id, b.result_id ?? null, b.code, name, x.definition, x.unit, x.type, x.direction, x.frequency,
       b.baseline ?? null, b.baseline_period ?? null, x.data_source, x.collection_method, b.responsible_org_id ?? null, b.attributes, b.definition_id ?? null, x.numerator_def, x.denominator_def]);
    return reply.code(201).send(row);
  });
  // Fiche d'un indicateur : définition, champs personnalisés, historique de toutes les valeurs (tous états) et actions permises à l'appelant.
  app.get('/indicators/:id', { preHandler: guard(READ) }, async (req, reply) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    return withTenant(pool, (req as any).principal, async (c) => {
      const ind = (await c.query(`SELECT id, project_id, result_id, code, name, definition, unit, type, direction, frequency, baseline::float8 AS baseline, baseline_period,
          data_source, collection_method, verification_status, responsible_org_id, attributes FROM indicator WHERE id = $1`, [id])).rows[0];
      if (!ind) return reply.code(404).send({ error: 'not_found' });
      const values = (await c.query(`SELECT id, period, period_end::text AS period_end, kind, value::float8 AS value, dimensions, workflow_state, comment
          FROM indicator_value WHERE indicator_id = $1 ORDER BY period_end DESC, kind LIMIT 300`, [id])).rows;
      const roles = (req as any).principal.roles as string[];
      return { ...ind, values: values.map((v) => ({ ...v, next: nextStates(v.workflow_state as State, roles) })) };
    });
  });
  // Recherche multilingue (arabe normalisé : tashkeel, alef, ta marbuta).
  app.get('/indicators', { preHandler: guard(READ) }, async (req) => {
    const f = z.object({ project_id: Uuid.optional(), search: z.string().optional() }).parse(req.query);
    return q(req, `SELECT id,code,name,unit,direction,frequency,baseline,result_id,attributes FROM indicator
      WHERE ($1::uuid IS NULL OR project_id=$1) AND ($2::text IS NULL OR app.search_text(name) LIKE '%' || app.norm_text($2) || '%')
      ORDER BY code LIMIT 200`, [f.project_id ?? null, f.search ?? null]);
  });
}
