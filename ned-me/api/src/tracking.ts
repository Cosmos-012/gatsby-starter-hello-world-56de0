import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type pg from 'pg';
import { withTenant } from './db.ts';
import { achievement, forecast, statusOf, trend, type Point } from './indicators.ts';

const READ = ['admin', 'me_manager', 'data_entry', 'reviewer', 'viewer'];

/**
 * Indicator Tracking Table. Seules les valeurs validées/approuvées/publiées comptent (actuals) ;
 * cibles : approuvées/publiées. `dimensions` = tranche exacte (ex. {"region":"Nord"}) ; absent => totaux.
 */
export function registerTracking(app: FastifyInstance, pool: pg.Pool) {
  app.get('/indicators/tracking', async (req, reply) => {
    if (!(req as any).principal.roles.some((r: string) => READ.includes(r))) return reply.code(403).send({ error: 'forbidden' });
    const f = z.object({
      project_id: z.string().uuid().optional(), result_id: z.string().uuid().optional(), org_id: z.string().uuid().optional(),
      period: z.string().optional(), status: z.enum(['GREEN', 'AMBER', 'RED', 'GREY']).optional(),
      dimensions: z.string().optional().transform((s, ctx) => {
        if (!s) return {};
        try { const o = JSON.parse(s); if (o && typeof o === 'object' && !Array.isArray(o)) return o as Record<string, string>; } catch {}
        ctx.addIssue({ code: 'custom', message: 'dimensions must be a JSON object' }); return z.NEVER;
      }),
    }).parse(req.query);

    return withTenant(pool, (req as any).principal, (c) => trackingRows(c, f));
  });
}

export interface TrackingFilter { project_id?: string; result_id?: string; org_id?: string; period?: string; status?: string; dimensions: Record<string, string> }
export async function trackingRows(c: pg.PoolClient, f: TrackingFilter) {
  const th = (await c.query('SELECT green_min::float8 g, amber_min::float8 a FROM status_config')).rows[0];
  const thresholds = th ? { green: th.g, amber: th.a } : undefined;
  const inds = (await c.query(
    `SELECT id, code, name, unit, direction, baseline::float8 AS baseline, result_id, responsible_org_id
     FROM indicator WHERE ($1::uuid IS NULL OR project_id=$1) AND ($2::uuid IS NULL OR result_id=$2) AND ($3::uuid IS NULL OR responsible_org_id=$3)
     ORDER BY code`, [f.project_id ?? null, f.result_id ?? null, f.org_id ?? null])).rows;
  if (!inds.length) return [];
  const vals = (await c.query(
    `SELECT indicator_id, period, period_end::text AS period_end, kind, value::float8 AS value, workflow_state
     FROM indicator_value WHERE indicator_id = ANY($1) AND dimensions = $2::jsonb ORDER BY period_end`,
    [inds.map((i) => i.id), JSON.stringify(f.dimensions)])).rows;

  const rows = inds.map((i) => {
    const mine = vals.filter((v) => v.indicator_id === i.id);
    const actuals = mine.filter((v) => v.kind === 'actual' && ['validated', 'approved', 'published'].includes(v.workflow_state) && (!f.period || v.period <= f.period));
    const targets = mine.filter((v) => v.kind === 'target' && ['approved', 'published'].includes(v.workflow_state));
    const last = actuals[actuals.length - 1];
    const target = last ? targets.find((t) => t.period === last.period) : undefined;
    const ach = achievement(last?.value ?? null, target?.value ?? null, i.baseline, i.direction);
    const pts: Point[] = actuals.map((a) => ({ periodEnd: a.period_end, value: a.value }));
    const finalTarget = targets[targets.length - 1];
    const fc = finalTarget ? forecast(pts, finalTarget.period_end) : null;
    const fcAch = finalTarget && fc != null ? achievement(fc, finalTarget.value, i.baseline, i.direction) : null;
    return {
      indicator_id: i.id, result_id: i.result_id, code: i.code, name: i.name, unit: i.unit, direction: i.direction, baseline: i.baseline,
      period: last?.period ?? null, actual: last?.value ?? null, target: target?.value ?? null,
      gap: last && target ? last.value - target.value : null,
      achievement: ach == null ? null : Math.round(ach * 10000) / 10000, status: statusOf(ach, thresholds),
      trend: trend(pts, i.direction),
      forecast: fc == null ? null : Math.round(fc * 100) / 100,
      forecast_final_target: finalTarget?.value ?? null,
      at_risk: fcAch != null ? statusOf(fcAch, thresholds) === 'RED' || statusOf(fcAch, thresholds) === 'AMBER' : null,
    };
  });
  return f.status ? rows.filter((r) => r.status === f.status) : rows;
}
