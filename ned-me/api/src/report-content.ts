import { createHash } from 'node:crypto';

export type ReportType = 'monthly' | 'quarterly' | 'semiannual' | 'annual' | 'donor' | 'government' | 'executive' | 'me' | 'meal' | 'indicator' | 'dqa' | 'evaluation';
export const REPORT_TYPES: ReportType[] = ['monthly', 'quarterly', 'semiannual', 'annual', 'donor', 'government', 'executive', 'me', 'meal', 'indicator', 'dqa', 'evaluation'];

export interface Figure { key: string; value: number | null; source: string; as_of: string }
export interface Table { key: string; source: string; columns: string[]; rows: Record<string, unknown>[] }
export interface Meta { type: ReportType; title: string; project_id: string | null; period_start: string; period_end: string; as_of: string; generated_at: string }
export interface Content { meta: Meta; figures: Figure[]; tables: Table[] }

const PERIODIC = { figures: ['performance', 'data_quality', 'accountability', 'risks'], tables: ['indicators', 'alerts'] };
const FULL = { figures: ['performance', 'data_quality', 'evaluations', 'accountability', 'risks', 'learning'], tables: ['indicators', 'risks', 'alerts'] };
/** Contenu de chaque type de rapport : groupes de chiffres et tables. */
export const COMPOSITION: Record<ReportType, { figures: string[]; tables: string[] }> = {
  monthly: PERIODIC, quarterly: PERIODIC, semiannual: PERIODIC, annual: FULL,
  donor: FULL, government: FULL, executive: FULL,
  me: { figures: ['performance', 'data_quality', 'risks'], tables: ['indicators', 'dq_issues', 'risks'] },
  indicator: { figures: ['performance'], tables: ['indicators'] },
  dqa: { figures: ['data_quality'], tables: ['dq_issues'] },
  evaluation: { figures: ['evaluations'], tables: ['overdue_actions'] },
  meal: { figures: ['accountability', 'learning'], tables: [] },
};

/** Aplatit l'aperçu du tableau de bord en chiffres, chacun avec sa source. Aucune valeur n'est calculée ici : on recopie. */
export function figuresOf(o: any): Figure[] {
  const f = (key: string, value: unknown, source: string): Figure => ({ key, value: typeof value === 'number' ? value : null, source, as_of: o.as_of });
  const p = o.performance, dq = o.data_quality, ev = o.evaluations, ac = o.accountability;
  return [
    f('performance.overall', p.overall, p.source), f('performance.coverage', p.coverage, p.source),
    f('performance.indicators_total', p.indicators_total, p.source), f('performance.with_data', p.with_data, p.source),
    ...(['GREEN', 'AMBER', 'RED', 'GREY'] as const).map((s) => f(`performance.status.${s}`, p.by_status[s], p.source)),
    f('performance.forecast_at_risk', p.forecast_at_risk, p.source),
    ...p.by_result_level.map((l: any) => f(`performance.level.${l.level}`, l.avg_achievement, p.source)),
    f('data_quality.average_score', dq.average_score, dq.source), f('data_quality.open_errors', dq.open_issues.error, dq.source), f('data_quality.open_warnings', dq.open_issues.warning, dq.source),
    f('evaluations.recommendations_total', ev.recommendations.total, ev.source), f('evaluations.closure_rate', ev.recommendations.closure_rate, ev.source),
    f('evaluations.unanswered', ev.recommendations.unanswered, ev.source), f('evaluations.overdue_actions', ev.recommendations.overdue_actions, ev.source),
    f('accountability.open_feedback', ac.open_feedback, ac.source), f('accountability.overdue_resolution', ac.overdue_resolution, ac.source),
    f('accountability.overdue_acknowledgement', ac.overdue_acknowledgement, ac.source), f('accountability.satisfaction_avg', ac.satisfaction_avg, ac.source),
    f('risks.open_total', o.risks.open_total, o.risks.source), f('risks.critical', o.risks.open_by_level.critical, o.risks.source), f('risks.high', o.risks.open_by_level.high, o.risks.source),
    f('risks.critical_unescalated', o.risks.critical_unescalated, o.risks.source), f('risks.review_overdue', o.risks.review_overdue, o.risks.source),
    f('risks.overdue_mitigations', o.risks.overdue_mitigations, o.risks.source), f('risks.open_issues', o.risks.open_issues_total, o.risks.source), f('risks.overdue_issues', o.risks.overdue_issues, o.risks.source),
    f('learning.total', o.learning.total, o.learning.source),
  ];
}

export interface Sources { overview: any; indicators: any[]; dqIssues: any[]; overdueActions: any[]; risks: any[]; risksSource: string; indicatorsSource: string; dqSource: string; actionsSource: string }

export function buildContent(meta: Meta, s: Sources): Content {
  const comp = COMPOSITION[meta.type];
  const figures = figuresOf(s.overview).filter((x) => comp.figures.includes(x.key.split('.')[0]));
  const all: Record<string, Table> = {
    indicators: { key: 'indicators', source: s.indicatorsSource, columns: ['code', 'name', 'unit', 'baseline', 'target', 'actual', 'gap', 'achievement', 'status', 'trend', 'forecast'],
      rows: s.indicators.map((r) => ({ code: r.code, name: r.name, unit: r.unit, baseline: r.baseline, target: r.target, actual: r.actual, gap: r.gap, achievement: r.achievement, status: r.status, trend: r.trend, forecast: r.forecast, indicator_id: r.indicator_id })) },
    alerts: { key: 'alerts', source: s.overview.performance.source, columns: ['severity', 'type', 'details'],
      rows: s.overview.alerts.map((a: any) => ({ severity: a.severity, type: a.type, details: a.params })) },
    dq_issues: { key: 'dq_issues', source: s.dqSource, columns: ['code', 'period', 'dimension', 'severity', 'message'],
      rows: s.dqIssues.map((r) => ({ code: r.indicator_code, period: r.period, dimension: r.dimension, severity: r.severity, message: r.message, indicator_id: r.indicator_id })) },
    risks: { key: 'risks', source: s.risksSource, columns: ['code', 'title', 'level', 'score', 'status', 'owner', 'escalation'],
      rows: s.risks.map((r) => ({ code: r.code, title: r.title, level: r.level, score: r.score, status: r.status, owner: r.owner_name, escalation: r.escalation_level, risk_id: r.id })) },
    overdue_actions: { key: 'overdue_actions', source: s.actionsSource, columns: ['description', 'responsible_name', 'due_date', 'days_late'],
      rows: s.overdueActions.map((a) => ({ description: a.description, responsible_name: a.responsible_name, due_date: a.due_date, days_late: a.days_late, action_id: a.id })) },
  };
  return { meta, figures, tables: comp.tables.map((t) => all[t]) };
}

/** JSON canonique (clés triées récursivement) : l'empreinte ne dépend pas de l'ordre d'insertion ni de jsonb. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as any)[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
export const hashContent = (c: Content) => createHash('sha256').update(canonical(c)).digest('hex');
