export type Dim = 'accuracy' | 'completeness' | 'consistency' | 'timeliness' | 'validity' | 'reliability';
export interface Val { period: string; periodEnd: string; kind: 'target' | 'actual'; value: number; dims: Record<string, string>; state: string }
export interface Ind {
  id: string; type: string; frequency: 'monthly' | 'quarterly' | 'semiannual' | 'annual';
  verification: string; dataSource: string | null;
}
export interface Rule { min?: number | null; max?: number | null; maxChangeRatio?: number | null; graceDays?: number }
export interface Issue { dimension: Dim; code: string; severity: 'error' | 'warning'; period: string; message: string }
export interface Result { issues: Issue[]; checks: Record<Dim, number>; failed: Record<Dim, number>; score: number }

const STEP = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 } as const;
const DAY = 86_400_000;

/** Dernier jour du mois, `months` mois après `d` (YYYY-MM-DD, UTC). */
export function addMonthsEnd(d: string, months: number): string {
  const t = new Date(d + 'T00:00:00Z');
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + months + 1, 0)).toISOString().slice(0, 10);
}

const zero = (): Record<Dim, number> => ({ accuracy: 0, completeness: 0, consistency: 0, timeliness: 0, validity: 0, reliability: 0 });

/** Contrôles DQA purs, déterministes (asOf fourni). Les valeurs archivées sont ignorées ; les brouillons sont contrôlés. */
export function evaluate(ind: Ind, all: Val[], rule: Rule, asOf: string): Result {
  const issues: Issue[] = [], checks = zero(), failed = zero();
  const flag = (dimension: Dim, code: string, severity: Issue['severity'], period: string, message: string) => {
    failed[dimension]++; issues.push({ dimension, code, severity, period, message });
  };
  const vals = all.filter((v) => v.state !== 'archived');
  const totals = vals.filter((v) => Object.keys(v.dims).length === 0);
  const actuals = totals.filter((v) => v.kind === 'actual').sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  const targets = new Set(totals.filter((v) => v.kind === 'target').map((v) => v.period));
  const grace = rule.graceDays ?? 30;

  // Validité : bornes configurées ; pourcentage entre 0 et 100 ; pas de valeur négative pour un comptage.
  const lo = rule.min ?? (ind.type === 'number' || ind.type === 'percentage' ? 0 : null);
  const hi = rule.max ?? (ind.type === 'percentage' ? 100 : null);
  for (const v of vals) {
    checks.validity++;
    if ((lo != null && v.value < lo) || (hi != null && v.value > hi))
      flag('validity', 'out_of_range', 'error', v.period, `${v.kind} ${v.value} hors bornes [${lo ?? '-∞'}, ${hi ?? '+∞'}]`);
  }

  // Exactitude : variation relative excessive entre deux actuals consécutifs.
  const maxRatio = rule.maxChangeRatio ?? 2;
  for (let i = 1; i < actuals.length; i++) {
    checks.accuracy++;
    const prev = actuals[i - 1].value, cur = actuals[i].value;
    const ratio = Math.abs(cur - prev) / Math.max(Math.abs(prev), 1e-9);
    if (prev !== 0 && ratio > maxRatio) flag('accuracy', 'spike', 'warning', actuals[i].period, `variation de ${Math.round(ratio * 100)} % vs ${actuals[i - 1].period}`);
  }

  // Complétude (trous dans la série) et ponctualité (périodes échues sans donnée après la dernière).
  const anchor = [...actuals, ...totals.filter((v) => v.kind === 'target')].map((v) => v.periodEnd).sort()[0];
  if (anchor) {
    const have = new Set(actuals.map((a) => a.periodEnd));
    const lastActual = actuals.length ? actuals[actuals.length - 1].periodEnd : null;
    for (let e = addMonthsEnd(anchor, 0), n = 0; Date.parse(e) + grace * DAY <= Date.parse(asOf) && n < 600; e = addMonthsEnd(e, STEP[ind.frequency]), n++) {
      if (have.has(e)) { checks.completeness++; continue; }
      if (lastActual && e < lastActual) { checks.completeness++; flag('completeness', 'missing_period', 'error', e, `aucune valeur réelle pour la période finissant le ${e}`); }
      else { checks.timeliness++; flag('timeliness', 'overdue', 'error', e, `valeur attendue pour la période finissant le ${e}, en retard`); }
    }
  }

  // Cohérence : un actual sans cible ; somme des tranches d'une dimension = total (indicateurs de comptage).
  for (const a of actuals) { checks.consistency++; if (!targets.has(a.period)) flag('consistency', 'no_target', 'warning', a.period, 'valeur réelle sans cible pour la période'); }
  if (ind.type === 'number') {
    const slices = vals.filter((v) => v.kind === 'actual' && Object.keys(v.dims).length === 1);
    const groups = new Map<string, Val[]>();
    for (const s of slices) { const k = `${s.period}|${Object.keys(s.dims)[0]}`; groups.set(k, [...(groups.get(k) ?? []), s]); }
    for (const [k, g] of groups) {
      const t = actuals.find((a) => a.period === g[0].period);
      if (!t) continue;
      checks.consistency++;
      const sum = g.reduce((s, x) => s + x.value, 0);
      if (Math.abs(sum - t.value) > Math.max(1e-9, Math.abs(t.value) * 0.005))
        flag('consistency', 'slice_sum_mismatch', 'error', g[0].period, `somme des tranches « ${k.split('|')[1]} » = ${sum} ≠ total ${t.value}`);
    }
  }

  // Fiabilité : source renseignée, vérification, valeurs identiques répétées (≥ 3 périodes, non nulles).
  checks.reliability++; if (!ind.dataSource) flag('reliability', 'no_source', 'warning', '', 'source de données non renseignée');
  checks.reliability++; if (ind.verification !== 'verified') flag('reliability', 'unverified', ind.verification === 'disputed' ? 'error' : 'warning', '', `statut de vérification : ${ind.verification}`);
  checks.reliability++;
  for (let i = 2; i < actuals.length; i++) {
    if (actuals[i].value !== 0 && actuals[i].value === actuals[i - 1].value && actuals[i].value === actuals[i - 2].value) {
      flag('reliability', 'repeated_value', 'warning', actuals[i].period, `même valeur (${actuals[i].value}) sur 3 périodes consécutives`); break;
    }
  }

  const total = Object.values(checks).reduce((a, b) => a + b, 0), bad = Object.values(failed).reduce((a, b) => a + b, 0);
  return { issues, checks, failed, score: total === 0 ? 100 : Math.round((1 - Math.min(bad, total) / total) * 1000) / 10 };
}
