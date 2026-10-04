import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type pg from 'pg';
import { withTenant } from './db.ts';
import { evaluate, type Ind, type Val } from './dqa.ts';

const READ = ['admin', 'me_manager', 'data_entry', 'reviewer', 'viewer'];
const RUN = ['admin', 'me_manager', 'reviewer'];
const Uuid = z.string().uuid();
const AsOf = z.string().date().optional();

async function assess(c: pg.PoolClient, projectId: string | undefined, asOf: string) {
  const inds = (await c.query(
    `SELECT i.id, i.code, i.type, i.frequency, i.verification_status, i.data_source,
            r.min_value::float8 AS min, r.max_value::float8 AS max, r.max_change_ratio::float8 AS ratio, r.grace_days
     FROM indicator i LEFT JOIN dq_rule r ON r.tenant_id = i.tenant_id AND r.indicator_id = i.id
     WHERE ($1::uuid IS NULL OR i.project_id = $1) ORDER BY i.code`, [projectId ?? null])).rows;
  if (!inds.length) return [];
  const vals = (await c.query(
    `SELECT indicator_id, period, period_end::text AS period_end, kind, value::float8 AS value, dimensions, workflow_state
     FROM indicator_value WHERE indicator_id = ANY($1)`, [inds.map((i) => i.id)])).rows;
  return inds.map((i) => {
    const ind: Ind = { id: i.id, type: i.type, frequency: i.frequency, verification: i.verification_status, dataSource: i.data_source };
    const mine: Val[] = vals.filter((v) => v.indicator_id === i.id)
      .map((v) => ({ period: v.period, periodEnd: v.period_end, kind: v.kind, value: v.value, dims: v.dimensions, state: v.workflow_state }));
    const res = evaluate(ind, mine, { min: i.min, max: i.max, maxChangeRatio: i.ratio, graceDays: i.grace_days ?? undefined }, asOf);
    return { indicator_id: i.id as string, code: i.code as string, ...res };
  });
}

export function registerDqa(app: FastifyInstance, pool: pg.Pool) {
  const guard = (roles: string[]) => async (req: any, reply: any) => {
    if (!req.principal.roles.some((r: string) => roles.includes(r))) return reply.code(403).send({ error: 'forbidden' });
  };
  const today = () => new Date().toISOString().slice(0, 10);

  app.put('/dqa/rules/:indicator_id', { preHandler: guard(['admin', 'me_manager']) }, async (req) => {
    const { indicator_id } = z.object({ indicator_id: Uuid }).parse(req.params);
    const b = z.object({ min_value: z.number().nullable().optional(), max_value: z.number().nullable().optional(),
      max_change_ratio: z.number().positive().nullable().optional(), grace_days: z.number().int().min(0).optional() }).parse(req.body);
    return withTenant(pool, (req as any).principal, async (c) => (await c.query(
      `INSERT INTO dq_rule (tenant_id, indicator_id, min_value, max_value, max_change_ratio, grace_days)
       VALUES (app.current_tenant(), $1, $2, $3, $4, COALESCE($5, 30))
       ON CONFLICT (tenant_id, indicator_id) DO UPDATE SET min_value = $2, max_value = $3, max_change_ratio = $4, grace_days = COALESCE($5, dq_rule.grace_days)
       RETURNING indicator_id, min_value::float8, max_value::float8, max_change_ratio::float8, grace_days`,
      [indicator_id, b.min_value ?? null, b.max_value ?? null, b.max_change_ratio ?? null, b.grace_days ?? null])).rows[0]);
  });

  // Lecture seule : scores recalculés sans écrire.
  app.get('/dqa/scores', { preHandler: guard(READ) }, async (req) => {
    const f = z.object({ project_id: Uuid.optional(), as_of: AsOf }).parse(req.query);
    return withTenant(pool, (req as any).principal, async (c) =>
      (await assess(c, f.project_id, f.as_of ?? today())).map((r) => ({ indicator_id: r.indicator_id, code: r.code, score: r.score, checks: r.checks, failed: r.failed })));
  });

  // Exécution : persiste les anomalies (idempotent), rouvre celles qui réapparaissent, clôt automatiquement celles qui ont disparu.
  app.post('/dqa/run', { preHandler: guard(RUN) }, async (req) => {
    const f = z.object({ project_id: Uuid.optional(), as_of: AsOf }).parse(req.body ?? {});
    return withTenant(pool, (req as any).principal, async (c) => {
      const results = await assess(c, f.project_id, f.as_of ?? today());
      let detected = 0, autoResolved = 0;
      for (const r of results) {
        for (const i of r.issues) {
          await c.query(
            `INSERT INTO dq_issue (tenant_id, indicator_id, period, dimension, code, severity, message)
             VALUES (app.current_tenant(), $1, $2, $3, $4, $5, $6)
             ON CONFLICT (tenant_id, indicator_id, period, code) DO UPDATE
               SET message = EXCLUDED.message, severity = EXCLUDED.severity,
                   status = CASE WHEN dq_issue.status = 'waived' THEN 'waived' ELSE 'open' END,
                   resolved_by = CASE WHEN dq_issue.status = 'waived' THEN dq_issue.resolved_by END,
                   resolved_at = CASE WHEN dq_issue.status = 'waived' THEN dq_issue.resolved_at END`,
            [r.indicator_id, i.period, i.dimension, i.code, i.severity, i.message]);
          detected++;
        }
        const res = await c.query(
          `UPDATE dq_issue SET status = 'resolved', corrective_action = 'Condition corrigée (constat automatique)', resolved_by = 'system', resolved_at = now()
           WHERE indicator_id = $1 AND status = 'open'
             AND (period, code) NOT IN (SELECT * FROM unnest($2::text[], $3::text[]))`,
          [r.indicator_id, r.issues.map((i) => i.period), r.issues.map((i) => i.code)]);
        autoResolved += res.rowCount ?? 0;
      }
      const avg = results.length ? Math.round(results.reduce((s, r) => s + r.score, 0) / results.length * 10) / 10 : null;
      return { indicators: results.length, detected, auto_resolved: autoResolved, average_score: avg };
    });
  });

  app.get('/dqa/issues', { preHandler: guard(READ) }, async (req) => {
    const f = z.object({ project_id: Uuid.optional(), indicator_id: Uuid.optional(), status: z.enum(['open', 'resolved', 'waived']).optional(),
      dimension: z.enum(['accuracy', 'completeness', 'consistency', 'timeliness', 'validity', 'reliability']).optional() }).parse(req.query);
    return withTenant(pool, (req as any).principal, async (c) => (await c.query(
      `SELECT d.id, i.code AS indicator_code, d.indicator_id, d.period, d.dimension, d.code, d.severity, d.message, d.status, d.corrective_action, d.resolved_by
       FROM dq_issue d JOIN indicator i ON i.tenant_id = d.tenant_id AND i.id = d.indicator_id
       WHERE ($1::uuid IS NULL OR i.project_id = $1) AND ($2::uuid IS NULL OR d.indicator_id = $2)
         AND ($3::text IS NULL OR d.status = $3) AND ($4::text IS NULL OR d.dimension = $4)
       ORDER BY (d.severity = 'error') DESC, i.code, d.period LIMIT 500`,
      [f.project_id ?? null, f.indicator_id ?? null, f.status ?? null, f.dimension ?? null])).rows);
  });

  // Clôture avec action corrective obligatoire ; la dérogation (waived) est réservée aux managers.
  app.post('/dqa/issues/:id/close', { preHandler: guard(RUN) }, async (req, reply) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const b = z.object({ status: z.enum(['resolved', 'waived']), corrective_action: z.string().trim().min(5) }).parse(req.body);
    const p = (req as any).principal;
    if (b.status === 'waived' && !p.roles.some((r: string) => ['admin', 'me_manager'].includes(r))) return reply.code(403).send({ error: 'forbidden' });
    const row = await withTenant(pool, p, async (c) => (await c.query(
      `UPDATE dq_issue SET status = $2, corrective_action = $3, resolved_by = app.current_user_id(), resolved_at = now()
       WHERE id = $1 AND status = 'open' RETURNING id, status`, [id, b.status, b.corrective_action])).rows[0]);
    return row ?? reply.code(404).send({ error: 'open issue not found' });
  });
}
