export type Status = 'GREEN' | 'AMBER' | 'RED' | 'GREY';
export interface Overview {
  as_of: string; project_id: string | null;
  performance: { overall: number | null; coverage: number | null; indicators_total: number; with_data: number; by_status: Record<Status, number>;
    forecast_at_risk: number; by_result_level: { level: 'impact' | 'outcome' | 'output'; indicators: number; with_data: number; avg_achievement: number | null }[]; source: string };
  data_quality: { average_score: number | null; indicators_assessed: number; open_issues: { error: number; warning: number }; source: string };
  evaluations: { by_status: Record<string, number>; recommendations: { total: number; closure_rate: number | null; unanswered: number; overdue_actions: number }; source: string };
  accountability: { open_feedback: number; overdue_resolution: number; overdue_acknowledgement: number; satisfaction_avg: number | null; source: string };
  risks: { open_by_level: Record<'critical' | 'high' | 'medium' | 'low', number>; open_total: number; critical_unescalated: number; review_overdue: number; overdue_mitigations: number;
    open_issues_by_severity: Record<string, number>; open_issues_total: number; overdue_issues: number; source: string };
  learning: { total: number; by_status: Record<string, number>; source: string };
  alerts: { severity: 'critical' | 'warning'; type: string; params: Record<string, unknown> }[];
  not_available: string[];
}
export interface Project { id: string; code: string; name: Record<string, string>; status: string }
