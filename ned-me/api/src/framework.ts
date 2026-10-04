import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type pg from 'pg';
import { withTenant } from './db.ts';

const Name = z.object({ fr: z.string().optional(), ar: z.string().optional(), en: z.string().optional() })
  .refine((n) => n.fr || n.ar || n.en, 'at least one language required');
const Uuid = z.string().uuid();
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
      project_id: Uuid, result_id: Uuid.optional(), code: z.string().min(1), name: Name, definition: Name.optional(),
      unit: z.string().optional(), type: z.enum(['number', 'percentage', 'ratio', 'index', 'boolean']).default('number'),
      direction: z.enum(['increase', 'decrease']).default('increase'),
      frequency: z.enum(['monthly', 'quarterly', 'semiannual', 'annual']).default('quarterly'),
      baseline: z.number().finite().optional(), baseline_period: z.string().optional(),
      data_source: z.string().optional(), collection_method: z.string().optional(), responsible_org_id: Uuid.optional(),
    }).parse(req.body);
    const [row] = await q(req, `INSERT INTO indicator (tenant_id,project_id,result_id,code,name,definition,unit,type,direction,frequency,baseline,baseline_period,data_source,collection_method,responsible_org_id)
      VALUES (app.current_tenant(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id,code`,
      [b.project_id, b.result_id ?? null, b.code, b.name, b.definition ?? null, b.unit ?? null, b.type, b.direction, b.frequency,
       b.baseline ?? null, b.baseline_period ?? null, b.data_source ?? null, b.collection_method ?? null, b.responsible_org_id ?? null]);
    return reply.code(201).send(row);
  });
  // Recherche multilingue (arabe normalisé : tashkeel, alef, ta marbuta).
  app.get('/indicators', { preHandler: guard(READ) }, async (req) => {
    const f = z.object({ project_id: Uuid.optional(), search: z.string().optional() }).parse(req.query);
    return q(req, `SELECT id,code,name,unit,direction,frequency,baseline,result_id FROM indicator
      WHERE ($1::uuid IS NULL OR project_id=$1) AND ($2::text IS NULL OR app.search_text(name) LIKE '%' || app.norm_text($2) || '%')
      ORDER BY code LIMIT 200`, [f.project_id ?? null, f.search ?? null]);
  });
}
