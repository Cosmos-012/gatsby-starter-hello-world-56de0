import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import pg from 'pg';
import { allMigrations } from './migrations.ts';
import { makePool } from '../src/db.ts';
import { makeVerifier } from '../src/auth.ts';
import { buildApp } from '../src/app.ts';
import { validateAttributes, effective, fromTemplate, TEMPLATES, WIDGETS } from '../src/project-config.ts';

const ADMIN = process.env.ADMIN_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const DB = 'ned_cfg_test', SECRET = 'test-secret-test-secret-test-secret';
const T1 = 'aaaaaaaa-0000-0000-0000-000000000001', T2 = 'bbbbbbbb-0000-0000-0000-000000000002';
let pool: pg.Pool, app: ReturnType<typeof buildApp>, P1: string, P2: string;

const tok = (sub: string, tenant: string, roles: string[]) =>
  new SignJWT({ tenant_id: tenant, roles }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
const call = async (method: string, url: string, token: string, payload?: unknown) => {
  const r = await app.inject({ method: method as 'GET', url, payload: payload as object, headers: { authorization: `Bearer ${token}` } });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
};

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN }); await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB}`); await admin.query(`CREATE DATABASE ${DB}`); await admin.end();
  const owner = new pg.Client({ connectionString: ADMIN.replace(/\/[^/]*$/, `/${DB}`) }); await owner.connect();
  for (const sql of allMigrations()) await owner.query(sql);
  await owner.query(`DROP ROLE IF EXISTS ned_cfg_login; CREATE ROLE ned_cfg_login LOGIN PASSWORD 'x' IN ROLE ned_app`);
  await owner.query(`INSERT INTO tenant (id,name) VALUES ('${T1}','A'),('${T2}','B')`);
  await owner.end();
  pool = makePool(ADMIN.replace(/\/\/[^@]*@/, '//ned_cfg_login:x@').replace(/\/[^/]*$/, `/${DB}`));
  app = buildApp(pool, makeVerifier({ secret: SECRET }));
  const mgr = await tok('mgr', T1, ['me_manager']);
  const mgr2 = await tok('m2', T2, ['me_manager']);
  const pr1 = (await call('POST', '/programs', mgr, { code: 'G1', name: { fr: 'Programme' } })).body.id;
  const pr2 = (await call('POST', '/programs', mgr2, { code: 'G2', name: { fr: 'Programme' } })).body.id;
  P1 = (await call('POST', '/projects', mgr, { program_id: pr1, code: 'P1', name: { fr: 'Un' } })).body.id;
  P2 = (await call('POST', '/projects', mgr2, { program_id: pr2, code: 'P2', name: { fr: 'Deux' } })).body.id;
  assert.ok(P1 && P2);
});
after(async () => { await app.close(); await pool.end(); });

test('modèles : cohérents (widgets connus, clés de champs valides, trois langues partout)', () => {
  for (const t of TEMPLATES) {
    const c = fromTemplate(t.id);
    assert.equal(c.dashboard.widgets.length, WIDGETS.length);
    for (const l of Object.values(c.terminology.level_labels)) assert.ok(l.fr && l.en && l.ar, `${t.id}: libellé de niveau incomplet`);
    for (const f of c.custom_fields) { assert.ok(f.label.fr && f.label.en && f.label.ar, `${t.id}.${f.key}`); for (const o of f.options ?? []) assert.ok(o.label.fr && o.label.en && o.label.ar); }
    assert.ok(t.label.fr && t.label.en && t.label.ar);
  }
});

test('configuration effective : repli sur le modèle, modules de base jamais désactivables, widgets inconnus ignorés', () => {
  assert.equal(effective(null).template, 'generic');
  const c = effective({ template: 'health', modules: { indicators: false, risks: false }, terminology: {}, dashboard: { widgets: [{ id: 'alerts', visible: true }, { id: 'zzz', visible: true }] }, custom_fields: [], version: 3 });
  assert.equal(c.modules.indicators, true); assert.equal(c.modules.risks, false);
  assert.equal(c.dashboard.widgets[0].id, 'alerts'); assert.equal(c.dashboard.widgets.length, WIDGETS.length);
  assert.ok(!c.dashboard.widgets.some((w) => (w.id as string) === 'zzz'));
});

test('validateAttributes : types, liste, requis, date réelle, clé inconnue', () => {
  const defs = fromTemplate('health').custom_fields.concat([
    { key: 'n', type: 'number', label: { fr: 'n' }, required: true }, { key: 'd', type: 'date', label: { fr: 'd' }, required: false }, { key: 'b', type: 'boolean', label: { fr: 'b' }, required: false }]);
  assert.deepEqual(validateAttributes(defs, { n: 3, facility_level: 'primary', d: '2026-02-28', b: true }), []);
  assert.ok(validateAttributes(defs, {}).some((e) => e.includes('requis')));
  assert.ok(validateAttributes(defs, { n: '3' }).some((e) => e.includes('nombre')));
  assert.ok(validateAttributes(defs, { n: 1, facility_level: 'x' }).some((e) => e.includes('hors liste')));
  assert.ok(validateAttributes(defs, { n: 1, d: '2026-02-30' }).some((e) => e.includes('date')));
  assert.ok(validateAttributes(defs, { n: 1, zz: 1 }).some((e) => e.includes('inconnu')));
});

test('API : lecture par défaut, droits, version optimiste, modèle, modules de base protégés', async () => {
  const mgr = await tok('mgr', T1, ['me_manager']), viewer = await tok('v', T1, ['viewer']);
  const g = await call('GET', `/projects/${P1}/config`, viewer);
  assert.equal(g.status, 200); assert.equal(g.body.template, 'generic'); assert.equal(g.body.version, 0);
  assert.equal((await call('PUT', `/projects/${P1}/config`, viewer, { expected_version: 0, template: 'health' })).status, 403);   // lecteur : refus
  assert.equal((await call('PUT', `/projects/${P1}/config`, mgr, { expected_version: 0, modules: { indicators: false } })).status, 400);
  const ok = await call('POST', `/projects/${P1}/config/apply-template`, mgr, { template: 'health', expected_version: 0 });
  assert.equal(ok.status, 200); assert.equal(ok.body.template, 'health'); assert.equal(ok.body.version, 1); assert.equal(ok.body.modules.gis, true);
  assert.equal((await call('PUT', `/projects/${P1}/config`, mgr, { expected_version: 0, modules: { risks: false } })).status, 409);   // version périmée
  const off = await call('PUT', `/projects/${P1}/config`, mgr, { expected_version: 1, modules: { risks: false } });
  assert.equal(off.status, 200); assert.equal(off.body.modules.risks, false); assert.equal(off.body.version, 2);
  assert.equal((await call('POST', `/projects/${P1}/config/apply-template`, mgr, { template: 'nope', expected_version: 2 })).status, 400);
  assert.equal((await call('GET', `/projects/${P1}/config`, await tok('x', T2, ['viewer']))).status, 404);   // autre client : le projet n'existe pas
});

test('champs personnalisés : définis par projet, validés à la création, protégés contre la suppression, isolés entre projets', async () => {
  const mgr = await tok('mgr', T1, ['me_manager']);
  const put = await call('PUT', `/projects/${P1}/config`, mgr, { expected_version: 2, custom_fields: [
    { key: 'facility_level', type: 'select', label: { fr: 'Niveau' }, required: true, options: [{ value: 'a', label: { fr: 'A' } }, { value: 'b', label: { fr: 'B' } }] },
    { key: 'visits', type: 'number', label: { fr: 'Visites' } }] });
  assert.equal(put.status, 200);
  const base = { project_id: P1, name: { fr: 'Ind' } };
  assert.equal((await call('POST', '/indicators', mgr, { ...base, code: 'I1' })).status, 400);                                  // champ requis manquant
  assert.equal((await call('POST', '/indicators', mgr, { ...base, code: 'I1', attributes: { facility_level: 'zz' } })).status, 400);
  assert.equal((await call('POST', '/indicators', mgr, { ...base, code: 'I1', attributes: { facility_level: 'a', other: 1 } })).status, 400);
  const created = await call('POST', '/indicators', mgr, { ...base, code: 'I1', attributes: { facility_level: 'a', visits: 12 } });
  assert.equal(created.status, 201);
  const list = (await call('GET', `/indicators?project_id=${P1}`, mgr)).body;
  assert.deepEqual(list[0].attributes, { facility_level: 'a', visits: 12 });
  // retirer un champ utilisé : refusé ; changer de modèle qui le ferait disparaître : refusé
  const v = put.body.version;
  const rm = await call('PUT', `/projects/${P1}/config`, mgr, { expected_version: v, custom_fields: [{ key: 'visits', type: 'number', label: { fr: 'Visites' } }] });
  assert.equal(rm.status, 409); assert.equal(rm.body.error, 'field_in_use');
  assert.equal((await call('POST', `/projects/${P1}/config/apply-template`, mgr, { template: 'generic', expected_version: v })).status, 409);
  // le même code de champ n'existe pas pour un autre projet : P2 (autre client) n'est pas affecté
  const mgr2 = await tok('m2', T2, ['me_manager']);
  assert.equal((await call('POST', '/indicators', mgr2, { project_id: P2, name: { fr: 'X' }, code: 'X1', attributes: { facility_level: 'a' } })).status, 400);
  // définition invalide
  assert.equal((await call('PUT', `/projects/${P1}/config`, mgr, { expected_version: v, custom_fields: [{ key: 'Bad Key', type: 'text', label: { fr: 'x' } }] })).status, 400);
  assert.equal((await call('PUT', `/projects/${P1}/config`, mgr, { expected_version: v, custom_fields: [{ key: 'k1', type: 'select', label: { fr: 'x' } }] })).status, 400);
});

test('tableau de bord : expose widgets visibles, libellés de niveaux et modules en attente selon la configuration', async () => {
  const mgr = await tok('mgr', T1, ['me_manager']);
  const cur = (await call('GET', `/projects/${P1}/config`, mgr)).body;
  const r = await call('PUT', `/projects/${P1}/config`, mgr, { expected_version: cur.version, modules: { finance: false, meal: false },
    dashboard: { widgets: [{ id: 'alerts', visible: true }, { id: 'kpi_overall', visible: false }] }, terminology: { level_labels: { outcome: { fr: 'Bénéfice' } } } });
  assert.equal(r.status, 200);
  const o = (await call('GET', `/dashboard/overview?project_id=${P1}`, mgr)).body;
  assert.equal(o.config.widgets[0], 'alerts');
  assert.ok(!o.config.widgets.includes('kpi_overall'));                       // masqué par l'utilisateur
  assert.ok(!o.config.widgets.includes('accountability'));                    // masqué avec son module (meal)
  assert.ok(!o.not_available.includes('finance'));                            // module désactivé : n'est plus annoncé
  assert.ok(o.not_available.includes('activities'));
  assert.equal(o.config.level_labels.outcome.fr, 'Bénéfice');
  // sans projet : configuration générique
  const all = (await call('GET', '/dashboard/overview', mgr)).body;
  assert.equal(all.config.template, 'generic');
});

test('fiche indicateur : historique de toutes les valeurs, actions permises selon le rôle, isolation entre clients', async () => {
  const mgr = await tok('mgr', T1, ['me_manager']), entry = await tok('de', T1, ['data_entry']), viewer = await tok('v', T1, ['viewer']);
  const ind = (await call('GET', `/indicators?project_id=${P1}`, mgr)).body[0];
  const v = (await call('POST', '/indicator-values', entry, { indicator_id: ind.id, period: '2026-Q1', period_end: '2026-03-31', kind: 'actual', value: 42 })).body;
  const d = (await call('GET', `/indicators/${ind.id}`, entry)).body;
  assert.equal(d.code, 'I1'); assert.equal(d.values.length, 1); assert.equal(d.values[0].workflow_state, 'draft');
  assert.deepEqual(d.values[0].next, ['submitted']);                                                   // la saisie peut soumettre, pas valider
  assert.deepEqual((await call('GET', `/indicators/${ind.id}`, viewer)).body.values[0].next, []);      // lecteur : aucune action
  assert.equal(d.values[0].id, v.id);
  assert.equal((await call('GET', `/indicators/${ind.id}`, await tok('x', T2, ['viewer']))).status, 404);
  assert.equal((await call('GET', '/indicators/00000000-0000-0000-0000-000000000000', mgr)).status, 404);
});
