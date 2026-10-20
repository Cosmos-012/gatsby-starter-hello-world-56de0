import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type pg from 'pg';
import { getConnector, listConnectors, registerConnector, runConnector } from './connectors/index.ts';
import { makeKoboConnector } from './connectors/kobo.ts';

const ROLES = ['admin', 'me_manager', 'data_entry'];
const READ = [...ROLES, 'reviewer', 'viewer'];
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** « a.b.c » → { a: { b: { c } } } ; champs vides ignorés ; refuse tout nom hors du formulaire déclaré (et les noms dangereux). */
export function nest(values: Record<string, string>, allowed: Set<string>): Record<string, unknown> {
  const out: Record<string, any> = {};
  for (const [name, raw] of Object.entries(values)) {
    if (!allowed.has(name)) throw new Error(`champ inconnu : ${name}`);
    const v = raw.trim(); if (v === '') continue;
    const parts = name.split('.');
    if (parts.some((p) => FORBIDDEN_KEYS.has(p))) throw new Error(`champ interdit : ${name}`);
    let node = out;
    for (const p of parts.slice(0, -1)) node = (node[p] ??= {});
    node[parts[parts.length - 1]] = v;
  }
  return out;
}

export function registerIntegrations(app: FastifyInstance, pool: pg.Pool) {
  if (!getConnector('kobo')) registerConnector(makeKoboConnector());
  const guard = (roles: string[]) => async (req: any, reply: any) => { if (!req.principal.roles.some((r: string) => roles.includes(r))) return reply.code(403).send({ error: 'forbidden' }); };

  app.get('/integrations', { preHandler: guard(READ) }, async () => listConnectors());

  app.post('/integrations/:id/run', { preHandler: guard(ROLES), config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, bodyLimit: 65_536 }, async (req, reply) => {
    const { id } = z.object({ id: z.string().regex(/^[a-z][a-z0-9_-]{1,30}$/) }).parse(req.params);
    const b = z.object({ project_id: z.guid(), values: z.record(z.string(), z.string().max(2000)), skip_existing: z.boolean().default(false) }).strict().parse(req.body);
    const conn = getConnector(id);
    if (!conn) return reply.code(404).send({ status: 'failed', reason: 'unknown_connector' });
    let config: Record<string, unknown>;
    try { config = nest(b.values, new Set(conn.form.map((f) => f.name))); }
    catch (e) { return reply.code(400).send({ status: 'failed', reason: 'invalid_config', message: (e as Error).message }); }
    const out = await runConnector(pool, (req as any).principal, id, config, b.project_id, { skipExisting: b.skip_existing });
    if (out.status === 'ok') return reply.code(201).send(out);
    if (out.status === 'has_errors') return reply.code(422).send(out);
    return reply.code(out.reason === 'unknown_connector' || out.reason === 'unknown_project' ? 404 : 400).send(out);
  });
}
