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
  config: OverviewConfig;
}
export interface Project { id: string; code: string; name: Record<string, string>; status: string }

export type Label = Partial<Record<'fr' | 'ar' | 'en', string>>;
export interface FieldDef { key: string; type: 'text' | 'number' | 'select' | 'date' | 'boolean'; label: Label; required: boolean; options?: { value: string; label: Label }[] }
export interface ProjectConfig {
  template: string; modules: Record<string, boolean>; terminology: { level_labels: Partial<Record<'impact' | 'outcome' | 'output', Label>> };
  dashboard: { widgets: { id: string; visible: boolean }[] }; custom_fields: FieldDef[]; version: number;
}
export interface ConfigCatalog { modules: { key: string; core: boolean; built: boolean }[]; widgets: string[]; templates: { id: string; label: Label }[] }
export interface OverviewConfig { template: string; modules: Record<string, boolean>; widgets: string[]; level_labels: Partial<Record<'impact' | 'outcome' | 'output', Label>>; pending: string[] }

export interface TrackingRow {
  indicator_id: string; result_id: string | null; code: string; name: Label; unit: string | null; direction: 'increase' | 'decrease'; baseline: number | null;
  period: string | null; actual: number | null; target: number | null; gap: number | null; achievement: number | null; status: Status;
  trend: 'improving' | 'declining' | 'flat' | 'insufficient'; forecast: number | null; at_risk: boolean | null;
}
export interface IndicatorListItem { id: string; code: string; attributes: Record<string, unknown> }
export interface IndicatorValue { id: string; period: string; period_end: string; kind: 'target' | 'actual'; value: number; dimensions: Record<string, string>; workflow_state: string; comment: string | null; next: string[] }
export interface IndicatorDetail {
  id: string; project_id: string; code: string; name: Label; definition: Label | null; unit: string | null; type: string; direction: 'increase' | 'decrease';
  frequency: string; baseline: number | null; baseline_period: string | null; data_source: string | null; collection_method: string | null; verification_status: string;
  attributes: Record<string, unknown>; values: IndicatorValue[];
}
