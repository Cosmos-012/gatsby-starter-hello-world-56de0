import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import pg from 'pg';
import { allMigrations } from './migrations.ts';
import { makePool, withTenant } from '../src/db.ts';
import { makeVerifier } from '../src/auth.ts';
import { buildApp } from '../src/app.ts';
import { sla } from '../src/meal.ts';

const ADMIN = process.env.ADMIN_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const DB = 'ned_meal_test', SECRET = 'test-secret-test-secret-test-secret';
const T1 = 'aaaaaaaa-0000-0000-0000-000000000001', T2 = 'bbbbbbbb-0000-0000-0000-000000000002';
let pool: pg.Pool, app: ReturnType<typeof buildApp>, projectId = '';
const SEED = { sub: 'seed', tenantId: T1, roles: [] as string[] };

const tok = (sub: string, tenant: string, roles: string[]) => new SignJWT({ tenant_id: tenant, roles }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
const call = async (method: string, url: string, token: string, payload?: unknown) => {
  const r = await app.inject({ method: method as 'GET', url, payload: payload as object, headers: { authorization: `Bearer ${token}` } });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
};

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN }); await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB}`); await admin.query(`CREATE DATABASE ${DB}`); await admin.end();
  const owner = new pg.Client({ connectionString: ADMIN.replace(/\/[^/]*$/, `/${DB}`) }); await owner.connect();
  for (const sql of allMigrations()) await owner.query(sql);
  await owner.query(`DROP ROLE IF EXISTS ned_meal_login; CREATE ROLE ned_meal_login LOGIN PASSWORD 'x' IN ROLE ned_app`);
  await owner.query(`INSERT INTO tenant (id,name) VALUES ('${T1}','A'),('${T2}','B')`);
  await owner.end();
  pool = makePool(ADMIN.replace(/\/\/[^@]*@/, '//ned_meal_login:x@').replace(/\/[^/]*$/, `/${DB}`));
  app = buildApp(pool, makeVerifier({ secret: SECRET }));
  await withTenant(pool, SEED, async (c) => {
    const prog = (await c.query("INSERT INTO program (tenant_id,code,name) VALUES (app.current_tenant(),'P','{\"fr\":\"p\"}') RETURNING id")).rows[0].id;
    projectId = (await c.query("INSERT INTO project (tenant_id,program_id,code,name) VALUES (app.current_tenant(),$1,'J','{\"fr\":\"j\"}') RETURNING id", [prog])).rows[0].id;
  });
});
after(async () => { await app.close(); await pool.end(); });

test('sla : délais par gravité, aucun pour la satisfaction', () => {
  const t = new Date('2026-01-01T00:00:00Z');
  assert.equal(sla('complaint', 'critical', t).due!.toISOString(), '2026-01-04T00:00:00.000Z');
  assert.equal(sla('complaint', 'low', t).due!.toISOString(), '2026-01-31T00:00:00.000Z');
  assert.equal(sla('complaint', 'medium', t).ackDue!.toISOString(), '2026-01-03T00:00:00.000Z');
  assert.deepEqual(sla('satisfaction', 'medium', t), { ackDue: null, due: null });
});

let complaintId = '', sensitiveId = '';
const base = () => ({ project_id: projectId, kind: 'complaint', channel: 'hotline', subject: 'Retard de paiement', description: 'Les bénéficiaires attendent depuis deux mois', received_at: '2026-08-01T00:00:00Z' });

test('saisie : validations, anonymat, satisfaction, gravité minimale des signalements sensibles', async () => {
  const entry = await tok('dana', T1, ['data_entry']), viewer = await tok('v', T1, ['viewer']);
  assert.equal((await call('POST', '/feedback', viewer, base())).status, 403);
  assert.equal((await call('POST', '/feedback', entry, { ...base(), anonymous: true, contact: '+212600000000' })).status, 400);
  assert.equal((await call('POST', '/feedback', entry, { ...base(), kind: 'satisfaction' })).status, 400);                         // score manquant
  assert.equal((await call('POST', '/feedback', entry, { ...base(), satisfaction_score: 4 })).status, 400);                        // score sur une plainte
  assert.equal((await call('POST', '/feedback', entry, { ...base(), kind: 'satisfaction', satisfaction_score: 6 })).status, 400);
  const c = await call('POST', '/feedback', entry, { ...base(), severity: 'high', contact: '+212611111111' });
  assert.equal(c.status, 201); complaintId = c.body.id;
  assert.equal(c.body.due_at, '2026-08-08T00:00:00.000Z'); assert.equal(c.body.ack_due_at, '2026-08-03T00:00:00.000Z');
  const sat = await call('POST', '/feedback', entry, { ...base(), kind: 'satisfaction', satisfaction_score: 4, subject: 'Satisfaction atelier' });
  assert.equal(sat.status, 201); assert.equal(sat.body.due_at, null);
  // un data_entry peut saisir un signalement sensible (sans le relire) : pas de violation RLS à l'insertion
  const s = await call('POST', '/feedback', entry, { ...base(), kind: 'grievance', severity: 'low', is_sensitive: true, subject: 'Signalement de protection', received_at: '2026-09-01T00:00:00Z' });
  assert.equal(s.status, 201); assert.equal(s.body.severity, 'high'); sensitiveId = s.body.id;       // relevée à « high »
});

test('confidentialité : le signalement sensible est invisible pour les non-managers (RLS) ; contact masqué', async () => {
  const mgr = await tok('mgr', T1, ['me_manager']), rev = await tok('rick', T1, ['reviewer']), entry = await tok('dana', T1, ['data_entry']);
  const mgrIds = (await call('GET', '/feedback', mgr)).body.map((f: any) => f.id);
  assert.ok(mgrIds.includes(sensitiveId));
  for (const t of [rev, entry]) {
    assert.ok(!(await call('GET', '/feedback', t)).body.map((f: any) => f.id).includes(sensitiveId));
    assert.equal((await call('GET', `/feedback/${sensitiveId}`, t)).status, 404);
  }
  assert.equal((await call('POST', `/feedback/${sensitiveId}/transition`, rev, { to: 'acknowledged' })).status, 404);   // introuvable, pas « interdit »
  assert.equal((await call('GET', `/feedback/${complaintId}`, mgr)).body.submitter_contact, '+212611111111');
  assert.equal((await call('GET', `/feedback/${complaintId}`, rev)).body.submitter_contact, '[restreint]');
  assert.equal((await call('GET', '/meal/summary', rev)).body.feedback_by_kind_status.some((r: any) => r.kind === 'grievance'), false);   // exclu aussi des agrégats
  assert.equal((await call('GET', '/meal/summary', mgr)).body.feedback_by_kind_status.some((r: any) => r.kind === 'grievance'), true);
});

test('traitement : transitions, note de résolution, escalade, clôture par manager avec satisfaction du plaignant', async () => {
  const mgr = await tok('mgr', T1, ['me_manager']), rev = await tok('rick', T1, ['reviewer']), entry = await tok('dana', T1, ['data_entry']);
  const tr = (t: string, id: string, body: object) => call('POST', `/feedback/${id}/transition`, t, body);
  assert.equal((await tr(entry, complaintId, { to: 'acknowledged' })).status, 403);                    // data_entry ne traite pas
  assert.equal((await tr(rev, complaintId, { to: 'resolved', note: 'trop tôt pour résoudre' })).status, 409);   // saut interdit
  assert.equal((await tr(rev, complaintId, { to: 'acknowledged' })).status, 200);
  assert.equal((await tr(rev, complaintId, { to: 'escalated' })).status, 400);                         // destinataire requis
  assert.equal((await tr(rev, complaintId, { to: 'escalated', escalated_to: 'Directeur de projet', note: 'dépasse le mandat' })).status, 200);
  assert.equal((await tr(rev, complaintId, { to: 'investigating' })).status, 200);
  assert.equal((await tr(rev, complaintId, { to: 'resolved', note: 'ok' })).status, 400);              // note trop courte
  assert.equal((await tr(rev, complaintId, { to: 'resolved', note: 'Paiements régularisés le 15 septembre' })).status, 200);
  assert.equal((await tr(rev, complaintId, { to: 'closed', complainant_satisfied: true })).status, 403);   // clôture = manager
  assert.equal((await tr(mgr, complaintId, { to: 'closed' })).status, 400);                            // satisfaction du plaignant requise
  assert.equal((await tr(mgr, complaintId, { to: 'closed', complainant_satisfied: true })).status, 200);
  assert.equal((await tr(mgr, complaintId, { to: 'investigating' })).status, 409);                     // terminal
  const f = (await call('GET', `/feedback/${complaintId}`, mgr)).body;
  assert.equal(f.escalation_level, 1); assert.equal(f.escalated_to, 'Directeur de projet'); assert.equal(f.complainant_satisfied, true);
  assert.deepEqual(f.events.map((e: any) => e.to_status), ['received', 'acknowledged', 'escalated', 'investigating', 'resolved', 'closed']);
  assert.deepEqual(f.events.map((e: any) => e.actor), ['dana', 'rick', 'rick', 'rick', 'rick', 'mgr']);   // traçabilité
});

test('satisfaction : clôture directe uniquement ; retards de service et synthèse', async () => {
  const mgr = await tok('mgr', T1, ['me_manager']), rev = await tok('rick', T1, ['reviewer']), entry = await tok('dana', T1, ['data_entry']);
  const sat = (await call('GET', '/feedback?kind=satisfaction', mgr)).body[0];
  assert.equal((await call('POST', `/feedback/${sat.id}/transition`, rev, { to: 'acknowledged' })).status, 409);
  assert.equal((await call('POST', `/feedback/${sat.id}/transition`, mgr, { to: 'closed' })).status, 200);
  // plainte critique reçue le 10/09 : en retard de résolution et d'accusé au 30/09
  const late = (await call('POST', '/feedback', entry, { ...base(), severity: 'critical', subject: 'Équipement dangereux', received_at: '2026-09-10T00:00:00Z' })).body.id;
  const ontime = (await call('POST', '/feedback', entry, { ...base(), severity: 'low', subject: 'Suggestion de local', kind: 'suggestion', received_at: '2026-09-25T00:00:00Z' })).body.id;
  const od = (await call('GET', '/feedback?overdue_as_of=2026-09-30', rev)).body.map((f: any) => f.id);
  assert.ok(od.includes(late)); assert.ok(!od.includes(ontime));
  const s = (await call('GET', '/meal/summary?as_of=2026-09-30', mgr)).body;
  assert.equal(s.overdue_resolution, 2);                            // plainte critique + signalement sensible (due 08/09)
  assert.equal(s.overdue_acknowledgement, 3);                       // critique, sensible, + suggestion non accusée (due 27/09)
  assert.equal(s.satisfaction.avg, 4); assert.equal(s.satisfaction.n, 1);
  assert.equal(s.resolution.n, 1); assert.ok(s.resolution.avg_days > 0);
  const sr = (await call('GET', '/meal/summary?as_of=2026-09-30', rev)).body;
  assert.equal(sr.overdue_resolution, 1);                           // le relecteur ne voit pas le signalement sensible
});

test('apprentissage : adaptation exige une décision ; ségrégation auteur/validateur ; publication par manager ; recherche arabe', async () => {
  const mgr = await tok('mgr', T1, ['me_manager']), rev = await tok('rick', T1, ['reviewer']), entry = await tok('dana', T1, ['data_entry']), viewer = await tok('v', T1, ['viewer']);
  const mk = (body: object) => call('POST', '/lessons', entry, { project_id: projectId, description: 'Description détaillée de la leçon', tags: ['paiement'], ...body });
  assert.equal((await mk({ category: 'adaptation', title: 'Changer le mode de paiement' })).status, 409);   // décision absente : CHECK en base
  const ad = await mk({ category: 'adaptation', title: 'Changer le mode de paiement', decision: 'Passage au paiement mobile dès T4' });
  assert.equal(ad.status, 201);
  const ar = (await mk({ category: 'good_practice', title: 'التواصل المجتمعي المبكر', description: 'إشراك المستفيدين منذ مرحلة التصميم يقلل الشكاوى', tags: ['مجتمع'] })).body.id;
  const tr = (t: string, id: string, to: string) => call('POST', `/lessons/${id}/transition`, t, { to });
  assert.equal((await tr(entry, ar, 'validated')).status, 403);                  // data_entry : rôle insuffisant
  const own = await call('POST', '/lessons', await tok('rick', T1, ['reviewer', 'data_entry']), { project_id: projectId, category: 'lesson', title: 'Leçon écrite par le relecteur', description: 'Une leçon rédigée par rick lui-même' });
  assert.equal((await tr(await tok('rick', T1, ['reviewer']), own.body.id, 'validated')).status, 403);   // auteur ≠ validateur
  assert.equal((await tr(mgr, ar, 'published')).status, 409);                     // pas de publication sans validation (règle en base)
  assert.equal((await tr(rev, ar, 'validated')).body.validated_by, 'rick');
  assert.equal((await tr(rev, ar, 'published')).status, 403);                     // publication = manager
  assert.equal((await tr(mgr, ar, 'published')).status, 200);
  assert.equal((await call('GET', '/lessons', viewer)).body.length, 1);           // le lecteur ne voit que le publié
  assert.equal((await call('GET', `/lessons?q=${encodeURIComponent('المُستفيدين')}`, viewer)).body.length, 1);   // recherche arabe sans tashkeel
  assert.equal((await call('GET', `/lessons?tag=${encodeURIComponent('مجتمع')}`, viewer)).body.length, 1);
  assert.equal((await call('GET', '/lessons?category=adaptation', mgr)).body.length, 1);
});

test('isolation tenant', async () => {
  const other = await tok('o', T2, ['me_manager']);
  assert.deepEqual((await call('GET', '/feedback', other)).body, []);
  assert.deepEqual((await call('GET', '/lessons', other)).body, []);
  assert.equal((await call('GET', `/feedback/${complaintId}`, other)).status, 404);
  assert.equal((await call('POST', '/feedback', other, base())).status, 422);                  // projet d'un autre tenant
  assert.equal((await call('GET', '/meal/summary', other)).body.feedback_by_kind_status.length, 0);
});
