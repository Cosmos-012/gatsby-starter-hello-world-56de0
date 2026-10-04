import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type pg from 'pg';
import { withTenant } from './db.ts';

const READ = ['admin', 'me_manager', 'data_entry', 'reviewer', 'viewer'];
const MANAGE = ['admin', 'me_manager'];
const Uuid = z.string().uuid();
const Text = z.string().trim().min(3).max(4000);
const TYPES = ['baseline', 'midterm', 'endterm', 'impact', 'outcome', 'process', 'thematic', 'rapid'] as const;
const EVAL_STATUS = ['planned', 'ongoing', 'report_draft', 'completed', 'cancelled'] as const;
// Transitions d'évaluation autorisées (les règles de contenu — ex. au moins un constat — sont en base).
const NEXT: Record<string, string[]> = {
  planned: ['ongoing', 'cancelled'], ongoing: ['report_draft', 'cancelled'], report_draft: ['ongoing', 'completed', 'cancelled'], completed: [], cancelled: [],
};

export function registerEvaluations(app: FastifyInstance, pool: pg.Pool) {
  const guard = (roles: string[]) => async (req: any, reply: any) => {
    if (!req.principal.roles.some((r: string) => roles.includes(r))) return reply.code(403).send({ error: 'forbidden' });
  };
  const run = <T>(req: any, fn: (c: pg.PoolClient) => Promise<T>) => withTenant(pool, req.principal, fn);

  app.post('/evaluations', { preHandler: guard(MANAGE) }, async (req, reply) => {
    const b = z.object({ project_id: Uuid, title: z.string().trim().min(3), type: z.enum(TYPES), planned_start: z.string().date().optional(), planned_end: z.string().date().optional(),
      methodology: z.string().optional(), scope: z.string().optional(), sampling: z.string().optional(), evaluator_org_id: Uuid.optional(), report_evidence_id: Uuid.optional(),
      questions: z.array(Text).max(50).default([]) }).parse(req.body);
    const id = await run(req, async (c) => {
      const row = (await c.query(
        `INSERT INTO evaluation (tenant_id, project_id, title, type, planned_start, planned_end, methodology, scope, sampling, evaluator_org_id, report_evidence_id)
         VALUES (app.current_tenant(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [b.project_id, b.title, b.type, b.planned_start ?? null, b.planned_end ?? null, b.methodology ?? null, b.scope ?? null, b.sampling ?? null, b.evaluator_org_id ?? null, b.report_evidence_id ?? null])).rows[0];
      for (const [i, q] of b.questions.entries()) await c.query('INSERT INTO evaluation_question (tenant_id, evaluation_id, position, text) VALUES (app.current_tenant(),$1,$2,$3)', [row.id, i + 1, q]);
      return row.id as string;
    });
    return reply.code(201).send({ id });
  });

  app.get('/evaluations', { preHandler: guard(READ) }, async (req) => {
    const f = z.object({ project_id: Uuid.optional(), status: z.enum(EVAL_STATUS).optional(), type: z.enum(TYPES).optional() }).parse(req.query);
    return run(req, async (c) => (await c.query(
      `SELECT e.id, e.title, e.type, e.status, e.planned_start, e.planned_end,
              (SELECT count(*)::int FROM finding f WHERE f.evaluation_id = e.id) AS findings,
              (SELECT count(*)::int FROM recommendation r WHERE r.evaluation_id = e.id) AS recommendations,
              (SELECT count(*)::int FROM recommendation r WHERE r.evaluation_id = e.id AND r.status = 'closed') AS recommendations_closed
       FROM evaluation e WHERE ($1::uuid IS NULL OR e.project_id = $1) AND ($2::text IS NULL OR e.status = $2) AND ($3::text IS NULL OR e.type = $3)
       ORDER BY e.planned_start NULLS LAST, e.title`, [f.project_id ?? null, f.status ?? null, f.type ?? null])).rows);
  });

  app.get('/evaluations/:id', { preHandler: guard(READ) }, async (req, reply) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    return run(req, async (c) => {
      const e = (await c.query('SELECT * FROM evaluation WHERE id = $1', [id])).rows[0];
      if (!e) return reply.code(404).send({ error: 'not found' });
      const q = async (sql: string) => (await c.query(sql, [id])).rows;
      return { ...e,
        questions: await q('SELECT id, position, text FROM evaluation_question WHERE evaluation_id = $1 ORDER BY position'),
        findings: await q('SELECT id, question_id, text FROM finding WHERE evaluation_id = $1 ORDER BY created_at'),
        recommendations: await q(`SELECT r.id, r.finding_id, r.text, r.priority, r.status, r.response_type, r.response_text,
            COALESCE((SELECT json_agg(json_build_object('id',a.id,'description',a.description,'responsible_name',a.responsible_name,'due_date',a.due_date,'status',a.status) ORDER BY a.due_date)
                      FROM recommendation_action a WHERE a.recommendation_id = r.id), '[]') AS actions
          FROM recommendation r WHERE r.evaluation_id = $1 ORDER BY r.created_at`) };
    });
  });

  app.post('/evaluations/:id/status', { preHandler: guard(MANAGE) }, async (req, reply) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const { to } = z.object({ to: z.enum(EVAL_STATUS) }).parse(req.body);
    return run(req, async (c) => {
      const cur = (await c.query('SELECT status FROM evaluation WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!cur) return reply.code(404).send({ error: 'not found' });
      if (!NEXT[cur.status].includes(to)) return reply.code(409).send({ error: `invalid transition ${cur.status} -> ${to}` });
      await c.query('UPDATE evaluation SET status = $2 WHERE id = $1', [id, to]);
      return { id, from: cur.status, to };
    });
  });

  app.post('/evaluations/:id/findings', { preHandler: guard(MANAGE) }, async (req, reply) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const b = z.object({ text: Text, question_id: Uuid.optional() }).parse(req.body);
    const row = await run(req, async (c) => (await c.query('INSERT INTO finding (tenant_id, evaluation_id, question_id, text) VALUES (app.current_tenant(),$1,$2,$3) RETURNING id', [id, b.question_id ?? null, b.text])).rows[0]);
    return reply.code(201).send(row);
  });

  app.post('/evaluations/:id/recommendations', { preHandler: guard(MANAGE) }, async (req, reply) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const b = z.object({ text: Text, finding_id: Uuid.optional(), priority: z.enum(['high', 'medium', 'low']).default('medium') }).parse(req.body);
    const row = await run(req, async (c) => (await c.query('INSERT INTO recommendation (tenant_id, evaluation_id, finding_id, text, priority) VALUES (app.current_tenant(),$1,$2,$3,$4) RETURNING id, status', [id, b.finding_id ?? null, b.text, b.priority])).rows[0]);
    return reply.code(201).send(row);
  });

  // Réponse du management : motif obligatoire (≥ 5 caractères) ; une seule réponse initiale.
  app.post('/recommendations/:id/response', { preHandler: guard(MANAGE) }, async (req, reply) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const b = z.object({ type: z.enum(['accepted', 'partially_accepted', 'rejected']), text: z.string().trim().min(5).max(4000) }).parse(req.body);
    const row = await run(req, async (c) => (await c.query(
      `UPDATE recommendation SET status = 'responded', response_type = $2, response_text = $3, responded_by = app.current_user_id(), responded_at = now()
       WHERE id = $1 AND status = 'open' RETURNING id, status, response_type`, [id, b.type, b.text])).rows[0]);
    return row ?? reply.code(409).send({ error: 'recommendation not found or already answered' });
  });

  app.post('/recommendations/:id/actions', { preHandler: guard(MANAGE) }, async (req, reply) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const b = z.object({ description: Text, responsible_name: z.string().trim().min(2), responsible_user: z.string().optional(), due_date: z.string().date() }).parse(req.body);
    const row = await run(req, async (c) => {
      const a = (await c.query(
        `INSERT INTO recommendation_action (tenant_id, recommendation_id, description, responsible_name, responsible_user, due_date)
         VALUES (app.current_tenant(),$1,$2,$3,$4,$5) RETURNING id, status`, [id, b.description, b.responsible_name, b.responsible_user ?? null, b.due_date])).rows[0];
      await c.query("UPDATE recommendation SET status = 'in_progress' WHERE id = $1 AND status = 'responded'", [id]);
      return a;
    });
    return reply.code(201).send(row);
  });

  // Exécution d'une action : par le responsable désigné ou un manager.
  app.post('/actions/:id/complete', { preHandler: guard([...MANAGE, 'data_entry', 'reviewer']) }, async (req, reply) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const b = z.object({ status: z.enum(['done', 'cancelled']).default('done'), note: z.string().trim().min(3) }).parse(req.body);
    const p = (req as any).principal;
    return run(req, async (c) => {
      const a = (await c.query('SELECT responsible_user, status FROM recommendation_action WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!a) return reply.code(404).send({ error: 'not found' });
      const manager = p.roles.some((r: string) => MANAGE.includes(r));
      if (!manager && a.responsible_user !== p.sub) return reply.code(403).send({ error: 'only the responsible person or a manager' });
      if (b.status === 'cancelled' && !manager) return reply.code(403).send({ error: 'only a manager can cancel an action' });
      if (a.status !== 'open') return reply.code(409).send({ error: 'action already closed' });
      await c.query('UPDATE recommendation_action SET status = $2, completion_note = $3, completed_at = now() WHERE id = $1', [id, b.status, b.note]);
      return { id, status: b.status };
    });
  });

  app.post('/recommendations/:id/close', { preHandler: guard(MANAGE) }, async (req, reply) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const row = await run(req, async (c) => (await c.query(
      `UPDATE recommendation SET status = 'closed', closed_by = app.current_user_id(), closed_at = now()
       WHERE id = $1 AND status IN ('responded','in_progress') RETURNING id, status`, [id])).rows[0]);
    return row ?? reply.code(409).send({ error: 'recommendation not found, still open (no response) or already closed' });
  });

  // Suivi : recommandations sans réponse, actions en retard, recommandations non clôturées.
  app.get('/recommendations/follow-up', { preHandler: guard(READ) }, async (req) => {
    const f = z.object({ project_id: Uuid.optional(), as_of: z.string().date().optional() }).parse(req.query);
    const asOf = f.as_of ?? new Date().toISOString().slice(0, 10);
    return run(req, (c) => followUp(c, f.project_id, asOf));
  });
}

export async function followUp(c: pg.PoolClient, projectId: string | undefined, asOf: string) {
  const params = [projectId ?? null, asOf];
  const unanswered = (await c.query(
    `SELECT r.id, r.text, r.priority, e.title AS evaluation FROM recommendation r JOIN evaluation e ON e.id = r.evaluation_id
     WHERE r.status = 'open' AND ($1::uuid IS NULL OR e.project_id = $1) ORDER BY (r.priority = 'high') DESC, r.created_at`, [params[0]])).rows;
  const overdue = (await c.query(
    `SELECT a.id, a.description, a.responsible_name, a.due_date, ($2::date - a.due_date)::int AS days_late, r.id AS recommendation_id, r.priority
     FROM recommendation_action a JOIN recommendation r ON r.id = a.recommendation_id JOIN evaluation e ON e.id = r.evaluation_id
     WHERE a.status = 'open' AND a.due_date < $2::date AND ($1::uuid IS NULL OR e.project_id = $1) ORDER BY a.due_date`, params)).rows;
  const counts = (await c.query(
    `SELECT r.status, count(*)::int AS n FROM recommendation r JOIN evaluation e ON e.id = r.evaluation_id
     WHERE ($1::uuid IS NULL OR e.project_id = $1) GROUP BY r.status`, [params[0]])).rows;
  const by = Object.fromEntries(counts.map((x) => [x.status, x.n]));
  const total = counts.reduce((s, x) => s + x.n, 0);
  return { as_of: asOf, total, by_status: by, closure_rate: total ? Math.round(((by.closed ?? 0) / total) * 1000) / 10 : null, unanswered, overdue_actions: overdue };
}
