import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import pg from 'pg';
import { allMigrations } from './migrations.ts';
import { makePool, withTenant } from '../src/db.ts';
import { makeVerifier } from '../src/auth.ts';
import { buildApp } from '../src/app.ts';

const ADMIN = process.env.ADMIN_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const DB = 'ned_evl_test', SECRET = 'test-secret-test-secret-test-secret';
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
  await owner.query(`DROP ROLE IF EXISTS ned_evl_login; CREATE ROLE ned_evl_login LOGIN PASSWORD 'x' IN ROLE ned_app`);
  await owner.query(`INSERT INTO tenant (id,name) VALUES ('${T1}','A'),('${T2}','B')`);
  await owner.end();
  pool = makePool(ADMIN.replace(/\/\/[^@]*@/, '//ned_evl_login:x@').replace(/\/[^/]*$/, `/${DB}`));
  app = buildApp(pool, makeVerifier({ secret: SECRET }));
  await withTenant(pool, SEED, async (c) => {
    const prog = (await c.query("INSERT INTO program (tenant_id,code,name) VALUES (app.current_tenant(),'P','{\"fr\":\"p\"}') RETURNING id")).rows[0].id;
    projectId = (await c.query("INSERT INTO project (tenant_id,program_id,code,name) VALUES (app.current_tenant(),$1,'J','{\"fr\":\"j\"}') RETURNING id", [prog])).rows[0].id;
  });
});
after(async () => { await app.close(); await pool.end(); });

let evalId = '', recA = '', recB = '', recC = '', actionId = '';

test('évaluation : cycle de vie, constat obligatoire avant clôture, transitions interdites', async () => {
  const mgr = await tok('mgr', T1, ['me_manager']), viewer = await tok('v', T1, ['viewer']);
  assert.equal((await call('POST', '/evaluations', viewer, {})).status, 403);
  assert.equal((await call('POST', '/evaluations', mgr, { project_id: projectId, title: 'x', type: 'midterm' })).status, 400);   // titre trop court
  assert.equal((await call('POST', '/evaluations', mgr, { project_id: projectId, title: 'Évaluation à mi-parcours', type: 'midterm', planned_start: '2026-06-01', planned_end: '2026-05-01' })).status, 409);   // fin < début
  const r = await call('POST', '/evaluations', mgr, { project_id: projectId, title: 'Évaluation à mi-parcours', type: 'midterm', planned_start: '2026-05-01', planned_end: '2026-08-01',
    methodology: 'Mixte', sampling: 'Aléatoire stratifié', questions: ['Les résultats sont-ils atteints ?', 'Le projet est-il durable ?'] });
  assert.equal(r.status, 201); evalId = r.body.id;
  const st = (to: string) => call('POST', `/evaluations/${evalId}/status`, mgr, { to });
  assert.equal((await st('completed')).status, 409);                // planned -> completed interdit
  assert.equal((await st('ongoing')).status, 200);
  assert.equal((await st('report_draft')).status, 200);
  assert.equal((await st('completed')).status, 409);                // aucun constat : refusé par la base
  const q = (await call('GET', `/evaluations/${evalId}`, mgr)).body.questions;
  assert.deepEqual(q.map((x: any) => x.position), [1, 2]);
  assert.equal((await call('POST', `/evaluations/${evalId}/findings`, mgr, { text: 'Les cibles sont atteintes à 70 %', question_id: q[0].id })).status, 201);
  assert.equal((await call('POST', `/evaluations/${evalId}/findings`, mgr, { text: 'Durabilité fragile faute de budget' })).status, 201);
  assert.equal((await st('completed')).status, 200);
  assert.equal((await st('ongoing')).status, 409);                  // terminal
});

test('recommandation : réponse obligatoire avant action ; motif requis ; rejet sans action', async () => {
  const mgr = await tok('mgr', T1, ['me_manager']);
  const finding = (await call('GET', `/evaluations/${evalId}`, mgr)).body.findings[0].id;
  const mk = async (text: string, priority = 'medium') => (await call('POST', `/evaluations/${evalId}/recommendations`, mgr, { text, finding_id: finding, priority })).body.id as string;
  recA = await mk('Renforcer le suivi trimestriel', 'high'); recB = await mk('Réviser la stratégie de communication'); recC = await mk('Supprimer le comité de pilotage', 'low');
  const act = (id: string, due = '2026-09-30') => call('POST', `/recommendations/${id}/actions`, mgr, { description: 'Mettre en place le tableau de bord', responsible_name: 'Responsable M&E', responsible_user: 'rick', due_date: due });
  assert.equal((await act(recA)).status, 409);                                                        // pas de réponse => pas d'action
  assert.equal((await call('POST', `/recommendations/${recA}/close`, mgr)).status, 409);              // clôture impossible sans réponse
  assert.equal((await call('POST', `/recommendations/${recA}/response`, mgr, { type: 'accepted', text: 'ok' })).status, 400);   // motif trop court
  assert.equal((await call('POST', `/recommendations/${recA}/response`, mgr, { type: 'accepted', text: 'Acceptée, mise en œuvre au T3' })).status, 200);
  assert.equal((await call('POST', `/recommendations/${recA}/response`, mgr, { type: 'rejected', text: 'Changement d’avis tardif' })).status, 409);   // réponse unique
  assert.equal((await call('POST', `/recommendations/${recC}/response`, mgr, { type: 'rejected', text: 'Hors mandat du projet, décision du comité' })).status, 200);
  assert.equal((await act(recC)).status, 409);                                                        // rejetée => pas d'action
  assert.equal((await call('POST', `/recommendations/${recC}/close`, mgr)).body.status, 'closed');    // rejet motivé clôturable
  const a = await act(recA, '2026-09-30'); assert.equal(a.status, 201); actionId = a.body.id;
  assert.equal((await call('POST', `/recommendations/${recA}/actions`, mgr, { description: 'x', responsible_name: 'A', due_date: '2026-09-30' })).status, 400);   // description trop courte
  assert.equal((await call('POST', `/recommendations/${recA}/actions`, mgr, { description: 'Action sans date', responsible_name: 'Resp' })).status, 400);       // échéance obligatoire
});

test('exécution des actions : responsable ou manager ; clôture exige action terminée et aucune ouverte', async () => {
  const mgr = await tok('mgr', T1, ['me_manager']), rick = await tok('rick', T1, ['reviewer']), eve = await tok('eve', T1, ['data_entry']), viewer = await tok('v', T1, ['viewer']);
  assert.equal((await call('POST', `/recommendations/${recA}/close`, mgr)).status, 409);              // action encore ouverte (409 base)
  assert.equal((await call('POST', `/actions/${actionId}/complete`, viewer, { note: 'fait' })).status, 403);
  assert.equal((await call('POST', `/actions/${actionId}/complete`, eve, { note: 'fait' })).status, 403);       // pas le responsable
  assert.equal((await call('POST', `/actions/${actionId}/complete`, rick, { note: 'ok' })).status, 400);        // note trop courte
  assert.equal((await call('POST', `/actions/${actionId}/complete`, rick, { status: 'cancelled', note: 'abandon' })).status, 403);   // annulation = manager
  const second = (await call('POST', `/recommendations/${recA}/actions`, mgr, { description: 'Former les équipes', responsible_name: 'RH', due_date: '2026-12-31' })).body.id;
  assert.equal((await call('POST', `/actions/${actionId}/complete`, rick, { note: 'tableau de bord livré' })).status, 200);
  assert.equal((await call('POST', `/actions/${actionId}/complete`, rick, { note: 'deuxième fois' })).status, 409);
  assert.equal((await call('POST', `/recommendations/${recA}/close`, mgr)).status, 409);              // la 2e action est encore ouverte
  assert.equal((await call('POST', `/actions/${second}/complete`, mgr, { status: 'cancelled', note: 'plus nécessaire' })).status, 200);
  assert.equal((await call('POST', `/recommendations/${recA}/close`, mgr)).body.status, 'closed');      // 1 done + 1 cancelled
  assert.equal((await call('POST', `/recommendations/${recA}/actions`, mgr, { description: 'Trop tard pour agir', responsible_name: 'Xavier', due_date: '2027-01-01' })).status, 409);   // clos
});

test('clôture impossible si toutes les actions sont annulées (aucune réalisée)', async () => {
  const mgr = await tok('mgr', T1, ['me_manager']);
  const rec = (await call('POST', `/evaluations/${evalId}/recommendations`, mgr, { text: 'Digitaliser la collecte' })).body.id;
  await call('POST', `/recommendations/${rec}/response`, mgr, { type: 'partially_accepted', text: 'Acceptée pour la phase 2 seulement' });
  const a = (await call('POST', `/recommendations/${rec}/actions`, mgr, { description: 'Pilote de collecte mobile', responsible_name: 'IT', due_date: '2026-11-01' })).body.id;
  await call('POST', `/actions/${a}/complete`, mgr, { status: 'cancelled', note: 'budget indisponible' });
  assert.equal((await call('POST', `/recommendations/${rec}/close`, mgr)).status, 409);
});

test('suivi : sans réponse, actions en retard, taux de clôture ; isolation tenant', async () => {
  const viewer = await tok('v', T1, ['viewer']), mgr = await tok('mgr', T1, ['me_manager']);
  // action en retard : recommandation B répondue + action échue
  await call('POST', `/recommendations/${recB}/response`, mgr, { type: 'accepted', text: 'Acceptée, plan de communication à revoir' });
  await call('POST', `/recommendations/${recB}/actions`, mgr, { description: 'Refonte du plan de communication', responsible_name: 'Com', due_date: '2026-10-01' });
  const f = (await call('GET', `/recommendations/follow-up?project_id=${projectId}&as_of=2026-10-31`, viewer)).body;
  assert.equal(f.total, 4); assert.equal(f.by_status.closed, 2); assert.equal(f.by_status.in_progress, 2);
  assert.equal(f.closure_rate, 50);
  assert.deepEqual(f.overdue_actions.map((a: any) => [a.description, a.days_late]), [['Refonte du plan de communication', 30]]);
  assert.equal(f.unanswered.length, 0);
  const none = (await call('GET', `/recommendations/follow-up?as_of=2026-09-01`, viewer)).body;
  assert.equal(none.overdue_actions.length, 0);                      // rien d'échéant avant le 1er octobre
  const list = (await call('GET', `/evaluations?project_id=${projectId}`, viewer)).body;
  assert.deepEqual([list[0].findings, list[0].recommendations, list[0].recommendations_closed], [2, 4, 2]);
  const other = await tok('o', T2, ['me_manager']);
  assert.deepEqual((await call('GET', '/evaluations', other)).body, []);
  assert.equal((await call('GET', `/evaluations/${evalId}`, other)).status, 404);
  assert.equal((await call('POST', `/recommendations/${recB}/close`, other)).status, 409);
  assert.equal((await call('GET', '/recommendations/follow-up', other)).body.total, 0);
});
