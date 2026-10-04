import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type pg from 'pg';
import type { Principal } from './auth.ts';
import { withTenant } from './db.ts';
import { registerRisks } from './risks.ts';
import { registerReports } from './reports.ts';
import { registerDashboard } from './dashboard.ts';
import { registerMeal } from './meal.ts';
import { registerEvaluations } from './evaluations.ts';
import { registerEvidence } from './evidence.ts';
import type { Storage } from './storage.ts';
import { registerDqa } from './dqa-routes.ts';
import { registerTracking } from './tracking.ts';
import { registerFramework } from './framework.ts';
import { canTransition, transitionExists, type State } from './workflow.ts';

type Verify = (token: string) => Promise<Principal>;
declare module 'fastify' { interface FastifyRequest { principal?: Principal } }

const Name = z.object({ fr: z.string().optional(), ar: z.string().optional(), en: z.string().optional() })
  .refine((n) => n.fr || n.ar || n.en, 'at least one language required');
const STATES = ['draft', 'submitted', 'review', 'validated', 'approved', 'published', 'archived'] as const;

export interface AppOptions {
  rateLimitMax?: number;          // requêtes / minute / IP (défaut 300)
  bodyLimit?: number;             // octets (défaut 1 Mo)
  trustProxy?: boolean;           // true derrière Caddy/Nginx : l'IP client vient de X-Forwarded-For
  logger?: boolean;
  logStream?: { write(msg: string): void };
}

export function buildApp(pool: pg.Pool, verify: Verify, storage?: Storage, opts: AppOptions = {}) {
  const app = Fastify({
    // L'en-tête Authorization n'est jamais journalisé.
    logger: opts.logger || opts.logStream ? { level: 'info', redact: ['req.headers.authorization', 'req.headers.cookie'], ...(opts.logStream ? { stream: opts.logStream } : {}) } : false,
    bodyLimit: opts.bodyLimit ?? 1_048_576,
    trustProxy: opts.trustProxy ?? false,
    genReqId: () => randomUUID(),
  });
  app.register(helmet, { hsts: { maxAge: 31_536_000, includeSubDomains: true } });
  // Limite globale par IP ; /health exclu. Les 401 comptent aussi (freine le brute-force de jetons).
  // global:false + hook racine posé via app.after() : le limiteur s'exécute AVANT l'authentification (sinon les 401 échappent au comptage).
  // Les routes coûteuses ajoutent leur propre limite plus stricte via config.rateLimit.
  app.register(rateLimit, { global: false, max: opts.rateLimitMax ?? 300, timeWindow: '1 minute', allowList: (req) => req.url === '/health' });
  app.after(() => { app.addHook('onRequest', app.rateLimit()); });
  app.addHook('onSend', async (req, reply) => { reply.header('x-request-id', req.id); });

  // Routes montées dans un contexte enfant, chargé APRÈS le limiteur : @fastify/rate-limit ne protège que les routes déclarées après son chargement.
  const mount = (app: FastifyInstance): void => {
  app.get('/health', async () => ({ ok: true }));

  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/health') return;
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) return reply.code(401).send({ error: 'unauthorized' });
    try { req.principal = await verify(h.slice(7)); }
    catch { return reply.code(401).send({ error: 'unauthorized' }); }
  });

  // PG : 23514 check, 42501 droits/ségrégation, 23503/23505 contraintes => erreurs client
  app.setErrorHandler((err: any, _req, reply) => {
    if (err?.name === 'ZodError') return reply.code(400).send({ error: 'validation', details: err.issues });
    const map: Record<string, number> = { '23514': 409, '42501': 403, '23503': 422, '23505': 409, '22P02': 400 };
    const code = map[err?.code];
    if (code) return reply.code(code).send({ error: err.message });
    // Erreurs client de Fastify (corps trop gros 413, JSON invalide 400, média non supporté 415…) : on conserve leur statut, sans détail interne.
    if (typeof err?.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.code ?? 'bad_request' });
    if (process.env.NED_DEBUG) console.error(err);
    return reply.code(500).send({ error: 'internal' });
  });

  const need = (req: any, reply: any, ...roles: string[]) => {
    if (!req.principal.roles.some((r: string) => roles.includes(r))) { reply.code(403).send({ error: 'forbidden' }); return false; }
    return true;
  };
  const ANY = ['admin', 'me_manager', 'data_entry', 'reviewer', 'viewer'];

  app.get('/projects', async (req, reply) => {
    if (!need(req, reply, ...ANY)) return;
    return withTenant(pool, req.principal!, async (c) =>
      (await c.query('SELECT id, code, name, status FROM project ORDER BY code')).rows);
  });

  app.post('/projects', async (req, reply) => {
    if (!need(req, reply, 'admin', 'me_manager')) return;
    const b = z.object({ program_id: z.string().uuid(), code: z.string().min(1), name: Name }).parse(req.body);
    const row = await withTenant(pool, req.principal!, async (c) =>
      (await c.query('INSERT INTO project (tenant_id, program_id, code, name) VALUES (app.current_tenant(), $1, $2, $3) RETURNING id, code',
        [b.program_id, b.code, b.name])).rows[0]);
    return reply.code(201).send(row);
  });

  app.get('/indicators/progress', async (req, reply) => {
    if (!need(req, reply, ...ANY)) return;
    const q = z.object({ project_id: z.string().uuid().optional(), status: z.enum(['GREEN', 'AMBER', 'RED', 'GREY']).optional() }).parse(req.query);
    return withTenant(pool, req.principal!, async (c) =>
      (await c.query(
        `SELECT p.indicator_id, p.code, p.baseline, p.period, p.actual, p.target, p.gap, round(p.achievement, 4) AS achievement, p.status
         FROM v_indicator_progress p
         WHERE ($1::uuid IS NULL OR p.project_id = $1) AND ($2::text IS NULL OR p.status = $2)
         ORDER BY p.code`, [q.project_id ?? null, q.status ?? null])).rows);
  });

  app.post('/indicator-values', async (req, reply) => {
    if (!need(req, reply, 'admin', 'me_manager', 'data_entry')) return;
    const b = z.object({
      indicator_id: z.string().uuid(), period: z.string().min(4), period_end: z.string().date(),
      kind: z.enum(['target', 'actual']), value: z.number().finite(),
      dimensions: z.record(z.string(), z.string()).default({}), comment: z.string().optional(),
    }).parse(req.body);
    const row = await withTenant(pool, req.principal!, async (c) =>
      (await c.query(
        `INSERT INTO indicator_value (tenant_id, indicator_id, period, period_end, kind, value, dimensions, comment)
         VALUES (app.current_tenant(), $1,$2,$3,$4,$5,$6,$7) RETURNING id, workflow_state`,
        [b.indicator_id, b.period, b.period_end, b.kind, b.value, b.dimensions, b.comment ?? null])).rows[0]);
    return reply.code(201).send(row);
  });

  app.post('/indicator-values/:id/transition', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({ to: z.enum(STATES), comment: z.string().optional() }).parse(req.body);
    return withTenant(pool, req.principal!, async (c) => {
      const cur = (await c.query('SELECT workflow_state FROM indicator_value WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!cur) return reply.code(404).send({ error: 'not found' });
      const from = cur.workflow_state as State;
      if (!transitionExists(from, b.to)) return reply.code(409).send({ error: `invalid transition ${from} -> ${b.to}` });
      if (!canTransition(from, b.to, req.principal!.roles)) return reply.code(403).send({ error: 'forbidden' });
      await c.query("SELECT set_config('app.comment', $1, true)", [b.comment ?? '']);   // lu par le déclencheur : le journal reste en ajout seul
      await c.query('UPDATE indicator_value SET workflow_state = $2 WHERE id = $1', [id, b.to]);
      return { id, from, to: b.to };
    });
  });

  registerTracking(app, pool);
  registerDqa(app, pool);
  registerEvaluations(app, pool);
  registerMeal(app, pool);
  registerDashboard(app, pool);
  registerReports(app, pool);
  registerRisks(app, pool);
  if (storage) registerEvidence(app, pool, storage);
  registerFramework(app, pool);
  };
  app.register(async (inst) => { mount(inst); });
  return app;
}
