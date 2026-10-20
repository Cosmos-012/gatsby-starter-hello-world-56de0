export type Direction = 'increase' | 'decrease';
export type Status = 'GREEN' | 'AMBER' | 'RED' | 'GREY';
export interface Point { periodEnd: string; value: number }
export interface Thresholds { green: number; amber: number }

/** Même formule que la vue SQL v_indicator_progress. */
export function achievement(actual: number | null, target: number | null, baseline: number | null, dir: Direction): number | null {
  if (actual == null || target == null) return null;
  const b = baseline ?? 0;
  const span = dir === 'increase' ? target - b : b - target;
  if (span === 0) return null;
  return (dir === 'increase' ? actual - b : b - actual) / span;
}

export function statusOf(a: number | null, t: Thresholds = { green: 0.9, amber: 0.6 }): Status {
  if (a == null) return 'GREY';
  return a >= t.green ? 'GREEN' : a >= t.amber ? 'AMBER' : 'RED';
}

/** Tendance entre les deux dernières valeurs, relative à la direction souhaitée (improving = va dans le bon sens). */
export function trend(actuals: Point[], dir: Direction): 'improving' | 'declining' | 'flat' | 'insufficient' {
  if (actuals.length < 2) return 'insufficient';
  const s = [...actuals].sort((x, y) => x.periodEnd.localeCompare(y.periodEnd));
  const d = s[s.length - 1].value - s[s.length - 2].value;
  if (d === 0) return 'flat';
  return (d > 0) === (dir === 'increase') ? 'improving' : 'declining';
}

const DAY = 86_400_000;
/** Prévision par régression linéaire (moindres carrés) des actuals validés, extrapolée à la date de la cible finale. Besoin d'au moins 3 points. */
export function forecast(actuals: Point[], atDate: string): number | null {
  if (actuals.length < 3) return null;
  const t0 = Date.parse(actuals.map((p) => p.periodEnd).sort()[0]);
  const xs = actuals.map((p) => (Date.parse(p.periodEnd) - t0) / DAY);
  const n = xs.length, mx = xs.reduce((a, b) => a + b) / n, my = actuals.reduce((a, p) => a + p.value, 0) / n;
  const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  if (sxx === 0) return null;
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (actuals[i].value - my), 0) / sxx;
  return my + slope * ((Date.parse(atDate) - t0) / DAY - mx);
}
