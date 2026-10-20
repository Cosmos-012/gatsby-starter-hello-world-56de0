import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { messagesFor, translatePlural, translate, numberTag, LOCALES, type Locale } from '../src/lib/i18n.ts';

const PLURAL = /\.(zero|one|two|few|many|other)$/;
const base = (l: Locale) => new Set(Object.keys(messagesFor(l)).map((k) => k.replace(PLURAL, '')));
const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort();
// Catégories exigées par CLDR pour chaque langue (hors « zero » arabe, repli sur « other »)
const REQUIRED: Record<Locale, string[]> = { fr: ['one', 'other'], en: ['one', 'other'], ar: ['one', 'two', 'few', 'many', 'other'] };

test('mêmes clés de base dans les trois langues ; aucune valeur vide', () => {
  const fr = base('fr');
  for (const l of LOCALES) {
    assert.deepEqual([...base(l)].sort(), [...fr].sort(), `clés différentes en ${l}`);
    for (const [k, v] of Object.entries(messagesFor(l))) assert.ok(v.trim().length > 0, `${l}:${k} vide`);
  }
});

test('pluriels : chaque groupe a toutes les catégories requises par la langue', () => {
  for (const l of LOCALES) {
    const m = messagesFor(l);
    const groups = new Set(Object.keys(m).filter((k) => PLURAL.test(k)).map((k) => k.replace(PLURAL, '')));
    for (const g of groups) for (const c of REQUIRED[l]) assert.ok(`${g}.${c}` in m, `${l}: ${g}.${c} manquant`);
    for (const g of groups) assert.ok(!(g in m), `${l}: ${g} à la fois simple et pluriel`);
  }
});

test('paramètres cohérents : chaque traduction utilise les mêmes {paramètres} que le français (formes « un/deux » arabes exceptées)', () => {
  const fr = messagesFor('fr');
  const frParams = (k: string) => params(fr[k] ?? fr[`${k}.other`] ?? '');
  for (const l of LOCALES) for (const [k, v] of Object.entries(messagesFor(l))) {
    const b = k.replace(PLURAL, '');
    const allowedOmission = /\.(one|two)$/.test(k) && l === 'ar';                 // « شكوى واحدة » n'écrit pas le nombre
    const expected = frParams(b), got = params(v);
    if (allowedOmission) assert.ok(got.every((p) => expected.includes(p)), `${l}:${k}`);
    else assert.deepEqual(got, expected, `${l}:${k} paramètres ${got} ≠ ${expected}`);
  }
});

test('choix de la forme plurielle (CLDR)', () => {
  const t = (l: Locale, n: number) => translatePlural(messagesFor(l), l, 'alert.overdue_complaints', n, { count: n });
  assert.equal(t('fr', 1), '1 plainte hors délai de résolution');
  assert.equal(t('fr', 0), '0 plainte hors délai de résolution');        // français : 0 au singulier
  assert.equal(t('fr', 2), '2 plaintes hors délai de résolution');
  assert.equal(t('en', 1), '1 complaint past resolution deadline');
  assert.equal(t('en', 3), '3 complaints past resolution deadline');
  assert.equal(t('ar', 1), 'شكوى واحدة تجاوزت مهلة الحل');
  assert.equal(t('ar', 2), 'شكويان تجاوزتا مهلة الحل');
  assert.equal(t('ar', 5), '5 شكاوى تجاوزت مهلة الحل');                   // few : 3–10
  assert.equal(t('ar', 11), '11 شكوى تجاوزت مهلة الحل');                  // many : 11–99
  assert.equal(t('ar', 100), '100 شكوى تجاوزت مهلة الحل');                // other
  assert.equal(translatePlural(messagesFor('ar'), 'ar', 'alert.overdue_action', 2, { days_late: 2 }), 'إجراء توصية متأخر بيومين');
});

test('toutes les alertes et modules que l\'API peut émettre ont une traduction', () => {
  const src = readFileSync(new URL('../../api/src/dashboard.ts', import.meta.url), 'utf8');
  const types = [...src.matchAll(/type: '([a-z_]+)'/g)].map((x) => x[1]);
  assert.ok(types.length >= 12, `types trouvés : ${types}`);
  const modules = [...src.matchAll(/NOT_AVAILABLE = \[([^\]]+)\]/g)][0][1].match(/'([a-z_]+)'/g)!.map((s) => s.slice(1, -1));
  for (const l of LOCALES) {
    const keys = base(l);
    for (const ty of types) assert.ok(keys.has(`alert.${ty}`), `${l}: alert.${ty}`);
    for (const mo of modules) assert.ok(keys.has(`na.${mo}`), `${l}: na.${mo}`);
  }
});

test('toutes les clés littérales utilisées par la page existent', () => {
  const page = readFileSync(new URL('../src/app/[locale]/page.tsx', import.meta.url), 'utf8');
  const used = [...page.matchAll(/\bt\('([a-z_.]+)'/g)].map((x) => x[1]);
  assert.ok(used.length > 30);
  for (const l of LOCALES) for (const k of used) assert.ok(base(l).has(k), `${l}: ${k}`);
});

test('chiffres : arabe en chiffres occidentaux par défaut, arabes-indiens sur option', () => {
  assert.equal(new Intl.NumberFormat(numberTag('ar', undefined)).format(123), '123');
  assert.equal(new Intl.NumberFormat(numberTag('ar', 'arab')).format(123), '١٢٣');
  assert.equal(translate({ x: 'a {b} c' }, 'x', { b: 1 }), 'a 1 c');
  assert.equal(translate({}, 'absente'), 'absente');                        // clé absente visible, jamais inventée
});
