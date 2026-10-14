import { test } from 'node:test';
import assert from 'node:assert/strict';
import { achievement, forecast, statusOf, trend } from '../src/indicators.ts';

test('achievement : increase, decrease, cas dégénérés', () => {
  assert.equal(achievement(50, 100, 0, 'increase'), 0.5);
  assert.equal(achievement(60, 100, 20, 'increase'), 0.5);       // (60-20)/(100-20)
  assert.equal(achievement(15, 10, 30, 'decrease'), 0.75);       // (30-15)/(30-10)
  assert.equal(achievement(5, 5, 5, 'increase'), null);          // cible = baseline
  assert.equal(achievement(null, 10, 0, 'increase'), null);
});
test('statusOf : seuils par défaut et personnalisés', () => {
  assert.equal(statusOf(0.9), 'GREEN'); assert.equal(statusOf(0.899), 'AMBER');
  assert.equal(statusOf(0.6), 'AMBER'); assert.equal(statusOf(0.59), 'RED'); assert.equal(statusOf(null), 'GREY');
  assert.equal(statusOf(0.8, { green: 0.8, amber: 0.5 }), 'GREEN');
  assert.equal(statusOf(1.5), 'GREEN'); assert.equal(statusOf(-0.2), 'RED');
});
test('trend est relative à la direction souhaitée', () => {
  const p = (a: number, b: number) => [{ periodEnd: '2026-03-31', value: a }, { periodEnd: '2026-06-30', value: b }];
  assert.equal(trend(p(10, 20), 'increase'), 'improving');
  assert.equal(trend(p(20, 10), 'increase'), 'declining');
  assert.equal(trend(p(20, 10), 'decrease'), 'improving');
  assert.equal(trend(p(10, 10), 'increase'), 'flat');
  assert.equal(trend([p(1, 2)[0]], 'increase'), 'insufficient');
  assert.equal(trend([...p(10, 20)].reverse(), 'increase'), 'improving');   // ordre d'entrée indifférent
});
test('forecast : régression linéaire, minimum 3 points', () => {
  const pts = [{ periodEnd: '2026-01-01', value: 10 }, { periodEnd: '2026-01-11', value: 20 }, { periodEnd: '2026-01-21', value: 30 }];
  assert.ok(Math.abs(forecast(pts, '2026-01-31')! - 40) < 1e-9);
  assert.equal(forecast(pts.slice(0, 2), '2026-01-31'), null);
  assert.equal(forecast(pts.map((p) => ({ ...p, periodEnd: '2026-01-01' })), '2026-02-01'), null);  // x constant
});
