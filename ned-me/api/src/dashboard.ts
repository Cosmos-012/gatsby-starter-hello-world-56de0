import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type pg from 'pg';
import { withTenant } from './db.ts';
import { trackingRows } from './tracking.ts';
import { assess } from './dqa-routes.ts';
import { followUp } from './evaluations.ts';
import { mealSummary } from './meal.ts';

const READ = ['admin', 'me_manager', 'data_entry', 'reviewer', 'viewer'];
const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
// Modules du premier écran pas encore construits : déclarés, jamais remplacés par des zéros inventés.
export const NOT_AVAILABLE = ['activities', 'risks', 'finance', 'procurement'] as const;

export interface Alert { severity: 'critical' | 'warning'; type: string; params: Record<string, unknown> }

/** Alertes par règles déterministes ; `type` = clé i18n côté interface, aucun texte codé en dur. */
export function buildAlerts(i: { red: any[]; atRisk: any[]; dqErrors: number; overdueActions: any[]; overdueComplaints: number; unackComplaints: number; unansweredHigh: any[] }): Alert[] {
  const out: Alert[] = [];
  if (i.dqErrors > 0) out.push({ severity: 'critical', type: 'dq_errors', params: { count: i.dqErrors } });
  for (const a of i.overdueActions.slice(0, 5)) out.push({ severity: a.days_late > 30 ? 'critical' : 'warning', type: 'overdue_action', params: { action_id: a.id, recommendation_id: a.recommendation_id, days_late: a.days_late } });
  if (i.overdueComplaints > 0) out.push({ severity: 'critical', type: 'overdue_complaints', params: { count: i.overdueComplaints } });
  if (i.unackComplaints > 0) out.push({ severity: 'warning', type: 'complaints_unacknowledged', params: { count: i.unackComplaints } });
  for (const r of [...i.red].sort((a, b) => (a.achievement ?? 0) - (b.achievement ?? 0)).slice(0, 5)) out.push({ severity: 'warning', type: 'red_indicator', params: { indicator_id: r.indicator_id, code: r.code, achievement: r.achievement } });
  for (const r of i.atRisk.slice(0, 5)) out.push({ severity: 'warning', type: 'forecast_at_risk', params: { indicator_id: r.indicator_id, code: r.code, forecast: r.forecast, target: r.forecast_final_target } });
  for (const r of i.unansweredHigh.slice(0, 5)) out.push({ severity: 'warning', type: 'unanswered_recommendation', params: { recommendation_id: r.id } });
  return out;
}

export function registerDashboard(app: FastifyInstance, pool: pg.Pool) {
  // Premier écran : « Quelle est la performance actuelle de mon projet ? » Chaque bloc cite l'endpoint dont il est issu.
  app.get('/dashboard/overview', async (req, reply) => {
    const p = (req as any).principal;
    if (!p.roles.some((r: string) => READ.includes(r))) return reply.code(403).send({ error: 'forbidden' });
    const f = z.object({ project_id: z.string().uuid().optional(), as_of: z.string().date().optional() }).parse(req.query);
    const asOf = f.as_of ?? new Date().toISOString().slice(0, 10);
    const qs = (extra: Record<string, string> = {}) => new URLSearchParams({ ...(f.project_id ? { project_id: f.project_id } : {}), ...extra }).toString();

    return withTenant(pool, p, async (c) => {
      const tracking = await trackingRows(c, { project_id: f.project_id, dimensions: {} });
      const levels = new Map<string, string>((await c.query('SELECT id, level FROM result')).rows.map((r) => [r.id, r.level]));
      const withData = tracking.filter((r) => r.achievement != null);
      const byStatus = { GREEN: 0, AMBER: 0, RED: 0, GREY: 0 } as Record<string, number>;
      for (const r of tracking) byStatus[r.status]++;
      const byLevel = ['impact', 'outcome', 'output'].map((level) => {
        const ind = tracking.filter((r) => r.result_id && levels.get(r.result_id) === level);
        const got = ind.filter((r) => r.achievement != null);
        const m = mean(got.map((r) => clamp01(r.achievement!)));
        return { level, indicators: ind.length, with_data: got.length, avg_achievement: m == null ? null : round(m) };
      });
      const overall = mean(withData.map((r) => clamp01(r.achievement!)));

      const dq = await assess(c, f.project_id, asOf);
      const dqIssues = (await c.query(
        `SELECT d.severity, count(*)::int AS n FROM dq_issue d JOIN indicator i ON i.tenant_id = d.tenant_id AND i.id = d.indicator_id
         WHERE d.status = 'open' AND ($1::uuid IS NULL OR i.project_id = $1) GROUP BY d.severity`, [f.project_id ?? null])).rows;
      const dqOpen = Object.fromEntries(dqIssues.map((r) => [r.severity, r.n]));
      const dqAvg = mean(dq.map((r) => r.score));

      const evalStatus = Object.fromEntries((await c.query(
        `SELECT status, count(*)::int AS n FROM evaluation WHERE ($1::uuid IS NULL OR project_id = $1) GROUP BY status`, [f.project_id ?? null])).rows.map((r) => [r.status, r.n]));
      const fu = await followUp(c, f.project_id, asOf);
      const meal = await mealSummary(c, f.project_id, asOf);
      const fb = meal.feedback_by_kind_status as { kind: string; status: string; n: number }[];
      const lessonByStatus: Record<string, number> = {};
      for (const l of meal.lessons as { status: string; n: number }[]) lessonByStatus[l.status] = (lessonByStatus[l.status] ?? 0) + l.n;

      const alerts = buildAlerts({
        red: tracking.filter((r) => r.status === 'RED'), atRisk: tracking.filter((r) => r.at_risk && r.status !== 'RED'),
        dqErrors: dqOpen.error ?? 0, overdueActions: fu.overdue_actions, overdueComplaints: meal.overdue_resolution,
        unackComplaints: meal.overdue_acknowledgement, unansweredHigh: fu.unanswered.filter((r: any) => r.priority === 'high'),
      });
      alerts.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1));

      return {
        as_of: asOf, project_id: f.project_id ?? null,
        performance: { overall: overall == null ? null : round(overall), indicators_total: tracking.length, with_data: withData.length,
          coverage: tracking.length ? round(withData.length / tracking.length) : null, by_status: byStatus,
          forecast_at_risk: tracking.filter((r) => r.at_risk).length, by_result_level: byLevel, source: `/indicators/tracking?${qs()}` },
        data_quality: { average_score: dqAvg == null ? null : round(dqAvg, 1), indicators_assessed: dq.length,
          open_issues: { error: dqOpen.error ?? 0, warning: dqOpen.warning ?? 0 }, source: `/dqa/scores?${qs({ as_of: asOf })}` },
        evaluations: { by_status: evalStatus, recommendations: { total: fu.total, closure_rate: fu.closure_rate, unanswered: fu.unanswered.length, overdue_actions: fu.overdue_actions.length },
          source: `/recommendations/follow-up?${qs({ as_of: asOf })}` },
        accountability: {
          open_feedback: fb.filter((x) => x.kind !== 'satisfaction' && !['resolved', 'closed'].includes(x.status)).reduce((s, x) => s + x.n, 0),
          overdue_resolution: meal.overdue_resolution, overdue_acknowledgement: meal.overdue_acknowledgement,
          satisfaction_avg: meal.satisfaction.avg, source: `/meal/summary?${qs({ as_of: asOf })}` },
        learning: { total: Object.values(lessonByStatus).reduce((a, b) => a + b, 0), by_status: lessonByStatus, source: `/lessons?${qs()}` },
        alerts, not_available: NOT_AVAILABLE,
      };
    });
  });
}
