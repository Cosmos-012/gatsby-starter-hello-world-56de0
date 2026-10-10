import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMonthsEnd, evaluate, type Ind, type Val } from '../src/dqa.ts';

const ind = (o: Partial<Ind> = {}): Ind => ({ id: 'i', type: 'number', frequency: 'quarterly', verification: 'verified', dataSource: 'MIS', ...o });
const v = (period: string, periodEnd: string, kind: 'target' | 'actual', value: number, dims = {}, state = 'validated'): Val => ({ period, periodEnd, kind, value, dims, state });
const codes = (r: ReturnType<typeof evaluate>) => r.issues.map((i) => `${i.dimension}:${i.code}${i.period ? '@' + i.period : ''}`).sort();
const Q = [['Q1', '2026-03-31'], ['Q2', '2026-06-30'], ['Q3', '2026-09-30']] as const;

test('addMonthsEnd gère fins de mois et années bissextiles', () => {
  assert.equal(addMonthsEnd('2026-03-31', 3), '2026-06-30');
  assert.equal(addMonthsEnd('2028-01-31', 1), '2028-02-29');
  assert.equal(addMonthsEnd('2026-11-30', 3), '2027-02-28');
  assert.equal(addMonthsEnd('2026-03-15', 0), '2026-03-31');
});

test('série saine : aucune anomalie, score 100', () => {
  const vals = Q.flatMap(([p, e], i) => [v(p, e, 'target', 100 * (i + 1)), v(p, e, 'actual', 90 * (i + 1))]);
  const r = evaluate(ind(), vals, {}, '2026-10-15');
  assert.deepEqual(codes(r), []); assert.equal(r.score, 100);
});

test('validité : négatif, pourcentage > 100, bornes configurées', () => {
  const neg = evaluate(ind(), [v('Q1', '2026-03-31', 'actual', -5)], {}, '2026-04-01');
  assert.ok(codes(neg).includes('validity:out_of_range@Q1'));
  const pct = evaluate(ind({ type: 'percentage' }), [v('Q1', '2026-03-31', 'actual', 120)], {}, '2026-04-01');
  assert.ok(codes(pct).includes('validity:out_of_range@Q1'));
  const custom = evaluate(ind(), [v('Q1', '2026-03-31', 'actual', 50)], { max: 40 }, '2026-04-01');
  assert.ok(codes(custom).includes('validity:out_of_range@Q1'));
  assert.ok(!codes(evaluate(ind({ type: 'index' }), [v('Q1', '2026-03-31', 'actual', -5)], {}, '2026-04-01')).some((c) => c.startsWith('validity')));
});

test('exactitude : pic détecté, seuil configurable, base nulle ignorée', () => {
  const vals = [v('Q1', '2026-03-31', 'actual', 10), v('Q2', '2026-06-30', 'actual', 100)];
  assert.ok(codes(evaluate(ind(), vals, {}, '2026-07-01')).includes('accuracy:spike@Q2'));
  assert.ok(!codes(evaluate(ind(), vals, { maxChangeRatio: 20 }, '2026-07-01')).includes('accuracy:spike@Q2'));
  assert.ok(!codes(evaluate(ind(), [v('Q1', '2026-03-31', 'actual', 0), v('Q2', '2026-06-30', 'actual', 100)], {}, '2026-07-01')).some((c) => c.includes('spike')));
});

test('complétude (trou) vs ponctualité (retard final), avec délai de grâce', () => {
  const vals = [v('Q1', '2026-03-31', 'actual', 10), v('Q3', '2026-09-30', 'actual', 30)];
  const r = evaluate(ind(), vals, {}, '2026-12-01');
  assert.ok(codes(r).includes('completeness:missing_period@2026-06-30'));
  assert.ok(codes(r).includes('timeliness:overdue@2026-12-31') === false);       // Q4 pas encore échu + grâce
  const late = evaluate(ind(), vals, {}, '2027-02-15');
  assert.ok(codes(late).includes('timeliness:overdue@2026-12-31'));
  const grace = evaluate(ind(), vals, { graceDays: 90 }, '2027-02-15');
  assert.ok(!codes(grace).includes('timeliness:overdue@2026-12-31'));
});

test('cohérence : actual sans cible ; somme des tranches ≠ total', () => {
  const vals = [v('Q1', '2026-03-31', 'actual', 100),
    v('Q1', '2026-03-31', 'actual', 60, { sex: 'F' }), v('Q1', '2026-03-31', 'actual', 30, { sex: 'M' })];
  const r = evaluate(ind(), vals, {}, '2026-04-01');
  assert.ok(codes(r).includes('consistency:no_target@Q1'));
  assert.ok(codes(r).includes('consistency:slice_sum_mismatch@Q1'));   // 90 ≠ 100
  const ok = evaluate(ind(), [...vals.slice(0, 2), v('Q1', '2026-03-31', 'actual', 40, { sex: 'M' })], {}, '2026-04-01');
  assert.ok(!codes(ok).includes('consistency:slice_sum_mismatch@Q1'));
  const pct = evaluate(ind({ type: 'percentage' }), vals, {}, '2026-04-01');
  assert.ok(!codes(pct).includes('consistency:slice_sum_mismatch@Q1')); // non applicable aux pourcentages
});

test('fiabilité : source, vérification, valeurs répétées ; archivés ignorés ; score borné', () => {
  const rep = Q.map(([p, e]) => v(p, e, 'actual', 50));
  const r = evaluate(ind({ dataSource: null, verification: 'disputed' }), rep, {}, '2026-10-15');
  assert.ok(codes(r).includes('reliability:no_source')); assert.ok(codes(r).includes('reliability:unverified'));
  assert.ok(codes(r).includes('reliability:repeated_value@Q3'));
  assert.equal(r.issues.find((i) => i.code === 'unverified')!.severity, 'error');
  const arch = evaluate(ind(), [v('Q1', '2026-03-31', 'actual', -5, {}, 'archived')], {}, '2026-04-01');
  assert.ok(!codes(arch).includes('validity:out_of_range@Q1'));
  assert.ok(r.score >= 0 && r.score <= 100 && r.score < 100);
  assert.equal(evaluate(ind(), [], {}, '2026-04-01').score >= 0, true);
});
