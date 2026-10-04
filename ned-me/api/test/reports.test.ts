import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import pg from 'pg';
import ExcelJS from 'exceljs';
import { makePool, withTenant } from '../src/db.ts';
import { makeVerifier } from '../src/auth.ts';
import { buildApp } from '../src/app.ts';
import { canonical, hashContent, COMPOSITION, REPORT_TYPES, type Content } from '../src/report-content.ts';
import { renderHtml, renderXlsx } from '../src/report-render.ts';
import { label, parseLangs, pick, LABELS } from '../src/i18n.ts';

const ADMIN = process.env.ADMIN_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const DB = 'ned_rpt_test', SECRET = 'test-secret-test-secret-test-secret';
const T1 = 'aaaaaaaa-0000-0000-0000-000000000001', T2 = 'bbbbbbbb-0000-0000-0000-000000000002';
const dir = new URL('../../db/migrations/', import.meta.url);
let pool: pg.Pool, app: ReturnType<typeof buildApp>, owner: pg.Client, projectId = '';
const SEED = { sub: 'seed', tenantId: T1, roles: [] as string[] };

const tok = (sub: string, tenant: string, roles: string[]) => new SignJWT({ tenant_id: tenant, roles }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
const call = async (method: string, url: string, token: string, payload?: unknown) => {
  const r = await app.inject({ method: method as 'GET', url, payload: payload as object, headers: { authorization: `Bearer ${token}` } });
  const isJson = (r.headers['content-type'] as string | undefined)?.includes('json');
  return { status: r.statusCode, body: isJson ? JSON.parse(r.body) : r.body, raw: r.rawPayload, headers: r.headers };
};

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN }); await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB}`); await admin.query(`CREATE DATABASE ${DB}`); await admin.end();
  owner = new pg.Client({ connectionString: ADMIN.replace(/\/[^/]*$/, `/${DB}`) }); await owner.connect();
  for (const f of ['001_foundation', '002_results_indicators', '004_arabic_search', '005_workflow', '006_dqa', '007_evidence', '008_evaluations', '009_meal', '010_reports']) await owner.query(readFileSync(new URL(`${f}.sql`, dir), 'utf8'));
  await owner.query(`DROP ROLE IF EXISTS ned_rpt_login; CREATE ROLE ned_rpt_login LOGIN PASSWORD 'x' IN ROLE ned_app`);
  await owner.query(`INSERT INTO tenant (id,name) VALUES ('${T1}','A'),('${T2}','B')`);
  pool = makePool(ADMIN.replace(/\/\/[^@]*@/, '//ned_rpt_login:x@').replace(/\/[^/]*$/, `/${DB}`));
  app = buildApp(pool, makeVerifier({ secret: SECRET }));
  await withTenant(pool, SEED, async (c) => {
    const prog = (await c.query("INSERT INTO program (tenant_id,code,name) VALUES (app.current_tenant(),'P','{\"fr\":\"p\"}') RETURNING id")).rows[0].id;
    projectId = (await c.query("INSERT INTO project (tenant_id,program_id,code,name) VALUES (app.current_tenant(),$1,'J','{\"fr\":\"j\"}') RETURNING id", [prog])).rows[0].id;
    const ind = async (code: string, name: object) => (await c.query("INSERT INTO indicator (tenant_id,project_id,code,name,baseline) VALUES (app.current_tenant(),$1,$2,$3,0) RETURNING id", [projectId, code, name])).rows[0].id;
    const val = (id: string, period: string, end: string, kind: string, v: number) => c.query(
      "INSERT INTO indicator_value (tenant_id,indicator_id,period,period_end,kind,value,workflow_state) VALUES (app.current_tenant(),$1,$2,$3,$4,$5,'approved')", [id, period, end, kind, v]);
    const a = await ind('A', { fr: 'Citoyens formés', ar: 'مواطنون مدربون' });
    await val(a, 'Q1', '2026-03-31', 'target', 100); await val(a, 'Q1', '2026-03-31', 'actual', 80);
    await val(a, 'Q2', '2026-06-30', 'target', 200); await val(a, 'Q2', '2026-06-30', 'actual', 190);   // après la fin de période Q1
    const x = await ind('XSS', { fr: '<img src=x onerror=alert(1)>', en: '=HYPERLINK("http://evil","x")' });
    await val(x, 'Q1', '2026-03-31', 'target', 10); await val(x, 'Q1', '2026-03-31', 'actual', 3);
  });
});
after(async () => { await app.close(); await pool.end(); await owner.end(); });

// ---------- purs ----------
test('canonical : indépendant de l\'ordre des clés ; hash stable et sensible à la moindre modification', () => {
  assert.equal(canonical({ b: 1, a: [2, { d: 1, c: 2 }] }), canonical({ a: [2, { c: 2, d: 1 }], b: 1 }));
  const c: Content = { meta: { type: 'me', title: 't', project_id: null, period_start: '2026-01-01', period_end: '2026-03-31', as_of: '2026-03-31', generated_at: 'x' },
    figures: [{ key: 'performance.overall', value: 0.5, source: '/s', as_of: '2026-03-31' }], tables: [] };
  assert.equal(hashContent(c), hashContent(JSON.parse(JSON.stringify(c))));
  const tampered = JSON.parse(JSON.stringify(c)); tampered.figures[0].value = 0.51;
  assert.notEqual(hashContent(c), hashContent(tampered));
});

test('i18n : toutes les clés requises existent en fr/ar/en ; bilingue ; noms multilingues', () => {
  for (const t of REPORT_TYPES) assert.ok(LABELS[`type.${t}`], `type.${t}`);
  for (const [k, v] of Object.entries(LABELS)) for (const l of ['fr', 'ar', 'en'] as const) assert.ok(v[l]?.length > 0, `${k}.${l}`);
  assert.equal(label('status.RED', ['ar', 'fr']), 'أحمر / Rouge');
  assert.equal(label('inconnu.cle', ['fr']), 'inconnu.cle');
  assert.deepEqual(parseLangs('ar,fr,xx,ar'), ['ar', 'fr']); assert.deepEqual(parseLangs(undefined), ['fr']);
  assert.equal(pick({ fr: 'Citoyens', ar: 'مواطنون' }, ['ar']), 'مواطنون');
  assert.equal(pick({ fr: 'Citoyens' }, ['ar']), 'Citoyens');       // repli
});
test('composition : chaque figure et table utilisée a un libellé dans le catalogue', async () => {
  const groups = new Set(Object.values(COMPOSITION).flatMap((c) => c.figures));
  for (const g of groups) assert.ok(Object.keys(LABELS).some((k) => k.startsWith(`fig.${g}.`)), g);
  for (const t of new Set(Object.values(COMPOSITION).flatMap((c) => c.tables))) assert.ok(LABELS[`table.${t}`], t);
});

// ---------- API ----------
let rptId = '';
test('génération : types, versions, chiffres traçables, période respectée', async () => {
  const mgr = await tok('mgr', T1, ['me_manager']), entry = await tok('dana', T1, ['data_entry']);
  assert.equal((await call('POST', '/reports', entry, { type: 'me', period_start: '2026-01-01', period_end: '2026-03-31' })).status, 403);
  assert.equal((await call('POST', '/reports', mgr, { type: 'nope', period_start: '2026-01-01', period_end: '2026-03-31' })).status, 400);
  assert.equal((await call('POST', '/reports', mgr, { type: 'me', period_start: '2026-04-01', period_end: '2026-03-31' })).status, 400);
  const r = await call('POST', '/reports', mgr, { project_id: projectId, type: 'me', title: 'Rapport S&E T1 2026', period_start: '2026-01-01', period_end: '2026-03-31' });
  assert.equal(r.status, 201); assert.equal(r.body.version, 1); assert.equal(r.body.status, 'draft'); rptId = r.body.id;
  const v = (await call('GET', `/reports/${rptId}`, mgr)).body, c: Content = v.content;
  assert.deepEqual(c.tables.map((t) => t.key), ['indicators', 'dq_issues']);
  assert.ok(c.figures.every((f) => f.source.startsWith('/') && f.as_of === '2026-03-31'));          // chaque chiffre cite sa source
  const A = c.tables[0].rows.find((x: any) => x.code === 'A') as any;
  assert.equal(A.actual, 80); assert.equal(A.target, 100);                                            // Q2 (190) exclu : après la fin de période
  assert.equal(c.figures.find((f) => f.key === 'performance.indicators_total')!.value, 2);
  assert.ok(!c.figures.some((f) => f.key.startsWith('accountability')));                                // composition du type « me »
  assert.equal((await call('GET', `/reports/${rptId}/verify`, mgr)).body.valid, true);
  const v2 = await call('POST', '/reports', mgr, { project_id: projectId, type: 'me', period_start: '2026-01-01', period_end: '2026-03-31' });
  assert.equal(v2.body.version, 2);                                                                  // nouvelle version, l'ancienne reste intacte
  const q2 = await call('POST', '/reports', mgr, { project_id: projectId, type: 'executive', period_start: '2026-01-01', period_end: '2026-06-30' });
  const ex: Content = (await call('GET', `/reports/${q2.body.id}`, mgr)).body.content;
  assert.equal((ex.tables[0].rows.find((x: any) => x.code === 'A') as any).actual, 190);             // période plus large : Q2 compte
  assert.ok(ex.figures.some((f) => f.key === 'learning.total'));
});

test('immuabilité et intégrité : contenu non modifiable ; une altération est détectée et bloque l\'export', async () => {
  const mgr = await tok('mgr', T1, ['me_manager']);
  await assert.rejects(() => withTenant(pool, { sub: 'mgr', tenantId: T1, roles: ['me_manager'] }, (c) => c.query("UPDATE report SET content = '{}' WHERE id = $1", [rptId])), /immutable/);
  await assert.rejects(() => withTenant(pool, { sub: 'mgr', tenantId: T1, roles: [] }, (c) => c.query('DELETE FROM report WHERE id = $1', [rptId])), /permission denied/);
  // altération hors application (propriétaire, trigger désactivé) : l'empreinte ne correspond plus
  await owner.query('ALTER TABLE report DISABLE TRIGGER report_rules');
  await owner.query(`UPDATE report SET content = jsonb_set(content, '{figures,0,value}', '0.99') WHERE id = '${rptId}'`);
  await owner.query('ALTER TABLE report ENABLE TRIGGER report_rules');
  const v = (await call('GET', `/reports/${rptId}/verify`, mgr)).body;
  assert.equal(v.valid, false); assert.notEqual(v.stored_hash, v.computed_hash);
  assert.equal((await call('GET', `/reports/${rptId}/export?format=xlsx`, mgr)).status, 409);
  // restauration pour la suite
  await owner.query('ALTER TABLE report DISABLE TRIGGER report_rules');
  await owner.query(`UPDATE report SET content = jsonb_set(content, '{figures,0,value}', to_jsonb((SELECT (content->'figures'->0->>'value')::float8 FROM report r2 WHERE r2.id <> '${rptId}' AND r2.type = 'me' AND r2.version = 2 LIMIT 1))) WHERE id = '${rptId}'`);
  await owner.query('ALTER TABLE report ENABLE TRIGGER report_rules');
});

test('exports : JSON, Excel (RTL, arabe, source par chiffre), HTML (échappement, dir=rtl)', async () => {
  const mgr = await tok('mgr', T1, ['me_manager']);
  const list = (await call('GET', `/reports?project_id=${projectId}&type=me`, mgr)).body;
  const id = list.find((r: any) => r.version === 2).id;
  const j = await call('GET', `/reports/${id}/export?format=json`, mgr);
  assert.equal(j.status, 200); assert.equal(j.body.content_hash.length, 64);
  const x = await call('GET', `/reports/${id}/export?format=xlsx&lang=ar,fr`, mgr);
  assert.equal(x.status, 200); assert.ok(String(x.headers['content-type']).includes('spreadsheetml'));
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(x.raw) as any);
  const first = wb.worksheets[0];
  assert.equal(first.views[0].rightToLeft, true);
  const rows: string[][] = []; first.eachRow((r) => rows.push((r.values as any[]).slice(1).map(String)));
  const overall = rows.find((r) => r[0].includes('الأداء العام / Performance globale'));
  assert.ok(overall, 'libellé bilingue'); assert.ok(overall![2].startsWith('/indicators/tracking'));   // source présente
  const ind = wb.worksheets.find((w) => w.name.includes('جدول'))!;
  const codes: unknown[] = []; ind.eachRow((r) => codes.push(r.getCell(1).value));
  assert.ok(codes.includes('A') && codes.includes('XSS'));
  const names: string[] = []; ind.eachRow((r) => names.push(String(r.getCell(2).value)));
  assert.ok(names.includes('مواطنون مدربون / Citoyens formés'));
  // injection de formule : un nom commençant par « = » reste du texte dans la cellule
  const xe = await call('GET', `/reports/${id}/export?format=xlsx&lang=en`, mgr);
  const wbe = new ExcelJS.Workbook(); await wbe.xlsx.load(Buffer.from(xe.raw) as any);
  const sheetEn = wbe.worksheets.find((w) => w.name.startsWith('Indicator'))!;
  let evil: ExcelJS.Cell | undefined; sheetEn.eachRow((r) => { const c = r.getCell(2); if (String(c.value).includes('HYPERLINK')) evil = c; });
  assert.ok(evil, 'cellule trouvée'); assert.equal(typeof evil!.value, 'string'); assert.equal(evil!.type, ExcelJS.ValueType.String);
  const h = await call('GET', `/reports/${id}/export?format=html&lang=ar`, mgr);
  assert.ok(h.body.includes('dir="rtl"') && h.body.includes('lang="ar"'));
  assert.ok(!h.body.includes('<img src=x'));                              // échappé
  assert.ok(h.body.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(String(h.headers['content-security-policy']).includes("default-src 'none'"));
  const fr = await call('GET', `/reports/${id}/export?format=html&lang=fr`, mgr);
  assert.ok(fr.body.includes('dir="ltr"') && fr.body.includes('Performance globale'));
  // rendu direct : un chiffre sans donnée n'est pas affiché comme 0
  const empty: Content = { meta: { type: 'me', title: 't', project_id: null, period_start: '2026-01-01', period_end: '2026-01-31', as_of: '2026-01-31', generated_at: 'x' },
    figures: [{ key: 'performance.overall', value: null, source: '/s', as_of: 'x' }], tables: [] };
  assert.ok(renderHtml(empty, 'h', 1, ['fr']).includes('Aucune donnée'));
  assert.ok((await renderXlsx(empty, 'h', 1, ['en'])).length > 1000);
});

test('workflow du rapport : droits, ségrégation auteur/validateur, visibilité, historique, versions publiées figées', async () => {
  const mgr = await tok('mgr', T1, ['me_manager']), rev = await tok('rick', T1, ['reviewer']), viewer = await tok('v', T1, ['viewer']);
  const mk = await call('POST', '/reports', rev, { project_id: projectId, type: 'donor', period_start: '2026-01-01', period_end: '2026-03-31' });
  const id = mk.body.id;                                             // auteur : rick
  const tr = (t: string, to: string, comment?: string) => call('POST', `/reports/${id}/transition`, t, { to, comment });
  assert.equal((await call('GET', `/reports/${id}`, viewer)).status, 404);          // brouillon invisible au lecteur
  assert.equal((await call('GET', `/reports/${id}/export?format=json`, viewer)).status, 404);
  assert.equal((await call('GET', '/reports', viewer)).body.length, 0);
  assert.equal((await tr(rev, 'validated')).status, 409);                            // saut interdit
  assert.equal((await tr(rev, 'submitted')).status, 200);
  assert.equal((await tr(rev, 'review')).status, 200);
  assert.equal((await tr(rev, 'validated')).status, 403);                            // ségrégation : l'auteur ne valide pas (base)
  { const rr = await tr(mgr, 'validated', 'Chiffres vérifiés'); assert.equal(rr.status, 200, JSON.stringify(rr.body)); }
  assert.equal((await tr(rev, 'approved')).status, 403);                             // reviewer n'approuve pas
  assert.equal((await tr(mgr, 'approved')).status, 200);
  assert.equal((await tr(mgr, 'draft')).status, 409);                                // approuvé : pas de retour arrière
  assert.equal((await tr(mgr, 'published')).status, 200);
  assert.equal((await call('GET', `/reports/${id}/export?format=json`, viewer)).status, 200);   // publié : visible
  assert.equal((await call('GET', '/reports', viewer)).body.length, 1);
  const ev = (await call('GET', `/reports/${id}`, mgr)).body.events;
  assert.deepEqual(ev.map((e: any) => `${e.actor}:${e.to_status}`), ['rick:submitted', 'rick:review', 'mgr:validated', 'mgr:approved', 'mgr:published']);
  assert.equal(ev[2].comment, 'Chiffres vérifiés');
  await assert.rejects(() => withTenant(pool, { sub: 'mgr', tenantId: T1, roles: [] }, (c) => c.query("UPDATE report SET content = '{}' WHERE id = $1", [id])), /immutable/);
});

test('isolation tenant', async () => {
  const other = await tok('o', T2, ['me_manager']);
  assert.deepEqual((await call('GET', '/reports', other)).body, []);
  assert.equal((await call('GET', `/reports/${rptId}`, other)).status, 404);
  assert.equal((await call('GET', `/reports/${rptId}/export?format=html`, other)).status, 404);
  assert.equal((await call('POST', '/reports', other, { project_id: projectId, type: 'me', period_start: '2026-01-01', period_end: '2026-03-31' })).status, 422);
});
