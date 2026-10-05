import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type pg from 'pg';
import { withTenant } from './db.ts';

const READ = ['admin', 'me_manager', 'data_entry', 'reviewer', 'viewer'];
const INTAKE = ['admin', 'me_manager', 'reviewer', 'data_entry'];
const WORK = ['admin', 'me_manager', 'reviewer'];
const MANAGE = ['admin', 'me_manager'];
const Uuid = z.guid();
const Score = z.number().int().min(1).max(5);
const CATEGORIES = ['strategic', 'operational', 'financial', 'procurement', 'technical', 'political', 'environmental_social', 'other'] as const;
const RISK_STATUS = ['open', 'mitigating', 'accepted', 'materialized', 'closed'] as const;
const ISSUE_STATUS = ['open', 'in_progress', 'escalated', 'resolved', 'closed'] as const;
const LEVELS = ['low', 'medium', 'high', 'critical'] as const;
const LIVE = `('open','mitigating','accepted')`;

export function registerRisks(app: FastifyInstance, pool: pg.Pool) {
  const guard = (roles: string[]) => async (req: any, reply: any) => {
    if (!req.principal.roles.some((r: string) => roles.includes(r))) return reply.code(403).send({ error: 'forbidden' });
  };
  const run = <T>(req: any, fn: (c: pg.PoolClient) => Promise<T>) => withTenant(pool, req.principal, fn);
  const isManager = (req: any) => req.principal.roles.some((r: string) => MANAGE.includes(r));
  const today = () => new Date().toISOString().slice(0, 10);

  // ---------- Risques ----------
  app.post('/risks', { preHandler: guard(INTAKE) }, async (req, reply) => {
    const b = z.object({ project_id: Uuid, code: z.string().trim().min(1).max(40), title: z.string().trim().min(3).max(300), description: z.string().max(4000).optional(),
      category: z.enum(CATEGORIES).default('other'), probability: Score, impact: Score, owner_name: z.string().trim().min(2), owner_user: z.string().optional(),
      review_due: z.string().date().optional(), result_ids: z.array(Uuid).max(50).default([]), indicator_ids: z.array(Uuid).max(50).default([]) }).parse(req.body);
    const id = randomUUID();
    const row = await run(req, async (c) => {
      const r = (await c.query(
        `INSERT INTO risk (id, tenant_id, project_id, code, title, description, category, probability, impact, owner_name, owner_user, review_due, created_by)
         VALUES ($1, app.current_tenant(), $2,$3,$4,$5,$6,$7,$8,$9,$10,$11, app.current_user_id()) RETURNING id, score, level`,
        [id, b.project_id, b.code, b.title, b.description ?? null, b.category, b.probability, b.impact, b.owner_name, b.owner_user ?? null, b.review_due ?? null])).rows[0];
      for (const rid of b.result_ids) await c.query('INSERT INTO risk_result (tenant_id, risk_id, result_id) VALUES (app.current_tenant(), $1, $2)', [id, rid]);
      for (const iid of b.indicator_ids) await c.query('INSERT INTO risk_indicator (tenant_id, risk_id, indicator_id) VALUES (app.current_tenant(), $1, $2)', [id, iid]);
      return r;
    });
    return reply.code(201).send(row);
  });

  app.get('/risks', { preHandler: guard(READ) }, async (req) => {
    const f = z.object({ project_id: Uuid.optional(), status: z.enum(RISK_STATUS).optional(), level: z.enum(LEVELS).optional(), result_id: Uuid.optional(), indicator_id: Uuid.optional(), as_of: z.string().date().optional() }).parse(req.query);
    return run(req, async (c) => (await c.query(
      `SELECT r.id, r.project_id, r.code, r.title, r.category, r.probability, r.impact, r.score, r.level, r.status, r.owner_name, r.review_due::text AS review_due, r.escalation_level, r.escalated_to,
              (r.level = 'critical' AND r.escalation_level = 0 AND r.status IN ('open','mitigating')) AS needs_escalation,
              COALESCE(r.review_due < $6::date AND r.status IN ${LIVE}, false) AS review_overdue,
              (SELECT count(*)::int FROM risk_mitigation m WHERE m.risk_id = r.id AND m.status = 'open') AS open_mitigations,
              (SELECT count(*)::int FROM risk_mitigation m WHERE m.risk_id = r.id AND m.status = 'open' AND m.due_date < $6::date) AS overdue_mitigations
       FROM risk r
       WHERE ($1::uuid IS NULL OR r.project_id = $1) AND ($2::text IS NULL OR r.status = $2) AND ($3::text IS NULL OR r.level = $3)
         AND ($4::uuid IS NULL OR EXISTS (SELECT 1 FROM risk_result x WHERE x.risk_id = r.id AND x.result_id = $4))
         AND ($5::uuid IS NULL OR EXISTS (SELECT 1 FROM risk_indicator x WHERE x.risk_id = r.id AND x.indicator_id = $5))
       ORDER BY r.score DESC, r.code LIMIT 500`,
      [f.project_id ?? null, f.status ?? null, f.level ?? null, f.result_id ?? null, f.indicator_id ?? null, f.as_of ?? today()])).rows);
  });

  app.get('/risks/:id', { preHandler: guard(READ) }, async (req, reply) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const out = await run(req, async (c) => {
      const r = (await c.query('SELECT id, project_id, code, title, description, category, probability, impact, score, level, status, owner_name, owner_user, review_due::text AS review_due, escalation_level, escalated_to, accepted_rationale, closure_note FROM risk WHERE id = $1', [id])).rows[0];
      if (!r) return null;
      const q = async (sql: string) => (await c.query(sql, [id])).rows;
      return { ...r,
        results: await q('SELECT x.result_id, e.code, e.level FROM risk_result x JOIN result e ON e.id = x.result_id WHERE x.risk_id = $1 ORDER BY e.code'),
        indicators: await q('SELECT x.indicator_id, i.code FROM risk_indicator x JOIN indicator i ON i.id = x.indicator_id WHERE x.risk_id = $1 ORDER BY i.code'),
        mitigations: await q('SELECT id, description, responsible_name, due_date::text AS due_date, status, completion_note FROM risk_mitigation WHERE risk_id = $1 ORDER BY due_date'),
        assessments: await q('SELECT probability, impact, score, actor, note, at FROM risk_assessment WHERE risk_id = $1 ORDER BY id') };
    });
    return out ?? reply.code(404).send({ error: 'not found' });
  });

  app.post('/risks/:id/assess', { preHandler: guard(WORK) }, async (req, reply) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const b = z.object({ probability: Score, impact: Score, note: z.string().trim().max(2000).optional() }).parse(req.body);
    const row = await run(req, async (c) => {
      await c.query("SELECT set_config('app.comment', $1, true)", [b.note ?? '']);
      return (await c.query('UPDATE risk SET probability = $2, impact = $3 WHERE id = $1 RETURNING id, score, level', [id, b.probability, b.impact])).rows[0];
    });
    return row ?? reply.code(404).send({ error: 'not found' });
  });

  app.post('/risks/:id/mitigations', { preHandler: guard(WORK) }, async (req, reply) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const b = z.object({ description: z.string().trim().min(3).max(4000), responsible_name: z.string().trim().min(2), responsible_user: z.string().optional(), due_date: z.string().date() }).parse(req.body);
    const row = await run(req, async (c) => (await c.query(
      `INSERT INTO risk_mitigation (tenant_id, risk_id, description, responsible_name, responsible_user, due_date) VALUES (app.current_tenant(),$1,$2,$3,$4,$5) RETURNING id, status`,
      [id, b.description, b.responsible_name, b.responsible_user ?? null, b.due_date])).rows[0]);
    return reply.code(201).send(row);
  });

  app.post('/risk-mitigations/:id/complete', { preHandler: guard(INTAKE) }, async (req, reply) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const b = z.object({ status: z.enum(['done', 'cancelled']).default('done'), note: z.string().trim().min(3) }).parse(req.body);
    const p = (req as any).principal;
    return run(req, async (c) => {
      const m = (await c.query('SELECT responsible_user, status FROM risk_mitigation WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!m) return reply.code(404).send({ error: 'not found' });
      if (!isManager(req) && m.responsible_user !== p.sub) return reply.code(403).send({ error: 'only the responsible person or a manager' });
      if (b.status === 'cancelled' && !isManager(req)) return reply.code(403).send({ error: 'only a manager can cancel' });
      if (m.status !== 'open') return reply.code(409).send({ error: 'already closed' });
      await c.query('UPDATE risk_mitigation SET status = $2, completion_note = $3, completed_at = now() WHERE id = $1', [id, b.status, b.note]);
      return { id, status: b.status };
    });
  });

  app.post('/risks/:id/transition', { preHandler: guard(MANAGE) }, async (req, reply) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const b = z.object({ to: z.enum(RISK_STATUS), rationale: z.string().trim().max(4000).optional(), note: z.string().trim().max(4000).optional() }).parse(req.body);
    const row = await run(req, async (c) => (await c.query(
      `UPDATE risk SET status = $2,
         accepted_rationale = CASE WHEN $2 = 'accepted' THEN $3 ELSE accepted_rationale END,
         closure_note = CASE WHEN $2 = 'closed' THEN $4 ELSE closure_note END,
         closed_at = CASE WHEN $2 = 'closed' THEN now() ELSE closed_at END
       WHERE id = $1 RETURNING id, status`, [id, b.to, b.rationale ?? null, b.note ?? null])).rows[0]);
    return row ?? reply.code(404).send({ error: 'not found' });
  });

  app.post('/risks/:id/escalate', { preHandler: guard(MANAGE) }, async (req, reply) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const b = z.object({ to: z.string().trim().min(2).max(200) }).parse(req.body);
    const row = await run(req, async (c) => (await c.query(
      `UPDATE risk SET escalation_level = escalation_level + 1, escalated_to = $2 WHERE id = $1 AND status <> 'closed' RETURNING id, escalation_level, escalated_to`, [id, b.to])).rows[0]);
    return row ?? reply.code(404).send({ error: 'not found' });
  });

  // ---------- Problèmes ----------
  app.post('/issues', { preHandler: guard(INTAKE) }, async (req, reply) => {
    const b = z.object({ project_id: Uuid, risk_id: Uuid.optional(), title: z.string().trim().min(3).max(300), description: z.string().max(4000).optional(),
      severity: z.enum(LEVELS).default('medium'), owner_name: z.string().trim().min(2), owner_user: z.string().optional(), due_date: z.string().date() }).parse(req.body);
    const id = randomUUID();
    await run(req, async (c) => {
      await c.query(
        `INSERT INTO issue (id, tenant_id, project_id, risk_id, title, description, severity, owner_name, owner_user, due_date, created_by)
         VALUES ($1, app.current_tenant(), $2,$3,$4,$5,$6,$7,$8,$9, app.current_user_id())`,
        [id, b.project_id, b.risk_id ?? null, b.title, b.description ?? null, b.severity, b.owner_name, b.owner_user ?? null, b.due_date]);
      // Un problème rattaché à un risque signifie que ce risque s'est matérialisé.
      if (b.risk_id) await c.query("UPDATE risk SET status = 'materialized' WHERE id = $1 AND status IN ('open','mitigating','accepted')", [b.risk_id]);
    });
    return reply.code(201).send({ id, status: 'open' });
  });

  app.get('/issues', { preHandler: guard(READ) }, async (req) => {
    const f = z.object({ project_id: Uuid.optional(), status: z.enum(ISSUE_STATUS).optional(), severity: z.enum(LEVELS).optional(), as_of: z.string().date().optional() }).parse(req.query);
    const asOf = f.as_of ?? today();
    return run(req, async (c) => (await c.query(
      `SELECT id, project_id, risk_id, title, severity, status, owner_name, due_date::text AS due_date, escalation_level, escalated_to,
              COALESCE(status IN ('open','in_progress','escalated') AND due_date < $4::date, false) AS overdue
       FROM issue WHERE ($1::uuid IS NULL OR project_id = $1) AND ($2::text IS NULL OR status = $2) AND ($3::text IS NULL OR severity = $3)
       ORDER BY (status IN ('resolved','closed')), (severity = 'critical') DESC, (severity = 'high') DESC, due_date LIMIT 500`, [f.project_id ?? null, f.status ?? null, f.severity ?? null, asOf])).rows);
  });

  app.post('/issues/:id/transition', { preHandler: guard(INTAKE) }, async (req, reply) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const b = z.object({ to: z.enum(ISSUE_STATUS), resolution: z.string().trim().max(4000).optional(), escalated_to: z.string().trim().min(2).optional() }).parse(req.body);
    const p = (req as any).principal;
    return run(req, async (c) => {
      const i = (await c.query('SELECT owner_user, status FROM issue WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!i) return reply.code(404).send({ error: 'not found' });
      if (!isManager(req) && i.owner_user !== p.sub) return reply.code(403).send({ error: 'only the owner or a manager' });
      if (b.to === 'closed' && !isManager(req)) return reply.code(403).send({ error: 'only a manager can close' });
      if (b.to === 'escalated' && !b.escalated_to) return reply.code(400).send({ error: 'escalated_to required' });
      await c.query(
        `UPDATE issue SET status = $2, resolution = COALESCE($3, resolution),
           escalation_level = escalation_level + CASE WHEN $2 = 'escalated' THEN 1 ELSE 0 END,
           escalated_to = CASE WHEN $2 = 'escalated' THEN $4 ELSE escalated_to END,
           closed_at = CASE WHEN $2 = 'closed' THEN now() ELSE closed_at END WHERE id = $1`, [id, b.to, b.resolution ?? null, b.escalated_to ?? null]);
      return { id, from: i.status, to: b.to };
    });
  });
}

/** Synthèse risques/problèmes pour le tableau de bord et les rapports (mêmes règles que les endpoints). */
export async function riskSummary(c: pg.PoolClient, projectId: string | undefined, asOf: string) {
  const p = [projectId ?? null, asOf];
  const rows = async (sql: string) => (await c.query(sql, sql.includes('$2') ? p : [p[0]])).rows;   // pg refuse les paramètres inutilisés
  const [levels, flags, issues, over] = await Promise.all([
    rows(`SELECT level, count(*)::int AS n FROM risk WHERE status IN ${LIVE} AND ($1::uuid IS NULL OR project_id = $1) GROUP BY level`),
    rows(`SELECT count(*) FILTER (WHERE level = 'critical' AND escalation_level = 0 AND status IN ('open','mitigating'))::int AS critical_unescalated,
                 count(*) FILTER (WHERE review_due < $2::date AND status IN ${LIVE})::int AS review_overdue FROM risk WHERE ($1::uuid IS NULL OR project_id = $1)`),
    rows(`SELECT severity, count(*)::int AS n FROM issue WHERE status IN ('open','in_progress','escalated') AND ($1::uuid IS NULL OR project_id = $1) GROUP BY severity`),
    rows(`SELECT (SELECT count(*)::int FROM issue WHERE status IN ('open','in_progress','escalated') AND due_date < $2::date AND ($1::uuid IS NULL OR project_id = $1)) AS overdue_issues,
                 (SELECT count(*)::int FROM risk_mitigation m JOIN risk r ON r.tenant_id = m.tenant_id AND r.id = m.risk_id
                  WHERE m.status = 'open' AND m.due_date < $2::date AND r.status IN ${LIVE} AND ($1::uuid IS NULL OR r.project_id = $1)) AS overdue_mitigations`),
  ]);
  const lv = Object.fromEntries(levels.map((r) => [r.level, r.n])), iv = Object.fromEntries(issues.map((r) => [r.severity, r.n]));
  return {
    open_by_level: { critical: lv.critical ?? 0, high: lv.high ?? 0, medium: lv.medium ?? 0, low: lv.low ?? 0 },
    open_total: Object.values(lv).reduce((a: number, b) => a + (b as number), 0),
    critical_unescalated: flags[0].critical_unescalated, review_overdue: flags[0].review_overdue, overdue_mitigations: over[0].overdue_mitigations,
    open_issues_by_severity: { critical: iv.critical ?? 0, high: iv.high ?? 0, medium: iv.medium ?? 0, low: iv.low ?? 0 },
    open_issues_total: Object.values(iv).reduce((a: number, b) => a + (b as number), 0), overdue_issues: over[0].overdue_issues,
  };
}
