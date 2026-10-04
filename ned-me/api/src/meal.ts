import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type pg from 'pg';
import { withTenant } from './db.ts';

const READ = ['admin', 'me_manager', 'data_entry', 'reviewer', 'viewer'];
const INTAKE = ['admin', 'me_manager', 'data_entry'];
const HANDLE = ['admin', 'me_manager', 'reviewer'];
const MANAGE = ['admin', 'me_manager'];
const Uuid = z.string().uuid();
const DAY = 86_400_000;
export const ACK_DAYS = 2;
export const RESOLVE_DAYS = { critical: 3, high: 7, medium: 14, low: 30 } as const;
const KINDS = ['feedback', 'complaint', 'grievance', 'suggestion', 'satisfaction'] as const;
const FB_STATUS = ['received', 'acknowledged', 'investigating', 'escalated', 'resolved', 'closed'] as const;
const NEXT: Record<string, string[]> = {
  received: ['acknowledged'], acknowledged: ['investigating', 'escalated', 'resolved'], investigating: ['escalated', 'resolved'],
  escalated: ['investigating', 'resolved'], resolved: ['closed', 'investigating'], closed: [],
};
const NEEDS_SATISFACTION_CHECK = new Set(['complaint', 'grievance']);

/** Échéances de service : accusé de réception 2 jours, résolution selon la gravité (satisfaction : aucune). */
export function sla(kind: string, severity: keyof typeof RESOLVE_DAYS, receivedAt: Date) {
  if (kind === 'satisfaction') return { ackDue: null, due: null };
  return { ackDue: new Date(receivedAt.getTime() + ACK_DAYS * DAY), due: new Date(receivedAt.getTime() + RESOLVE_DAYS[severity] * DAY) };
}

export function registerMeal(app: FastifyInstance, pool: pg.Pool) {
  const guard = (roles: string[]) => async (req: any, reply: any) => {
    if (!req.principal.roles.some((r: string) => roles.includes(r))) return reply.code(403).send({ error: 'forbidden' });
  };
  const run = <T>(req: any, fn: (c: pg.PoolClient) => Promise<T>) => withTenant(pool, req.principal, fn);
  const isManager = (req: any) => req.principal.roles.some((r: string) => MANAGE.includes(r));
  // Le contact du plaignant n'est exposé qu'aux managers.
  const mask = (req: any, row: any) => (isManager(req) ? row : { ...row, submitter_contact: row.submitter_contact ? '[restreint]' : null });
  const COLS = `id, project_id, kind, channel, severity, status, subject, description, anonymous, submitter_contact, is_sensitive, satisfaction_score, location,
                received_at, ack_due_at, due_at, acknowledged_at, resolved_at, resolution, escalation_level, escalated_to, complainant_satisfied, closed_at`;

  app.post('/feedback', { preHandler: guard(INTAKE) }, async (req, reply) => {
    const b = z.object({
      project_id: Uuid, kind: z.enum(KINDS), channel: z.enum(['hotline', 'box', 'sms', 'email', 'in_person', 'web', 'other']),
      severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'), subject: z.string().trim().min(3).max(300), description: z.string().trim().min(5).max(5000),
      anonymous: z.boolean().default(false), contact: z.string().trim().min(3).max(200).optional(), is_sensitive: z.boolean().default(false),
      satisfaction_score: z.number().int().min(1).max(5).optional(), location: z.string().max(200).optional(), received_at: z.string().datetime().optional(),
    }).parse(req.body);
    if (b.anonymous && b.contact) return reply.code(400).send({ error: 'anonymous feedback cannot carry contact details' });
    if ((b.kind === 'satisfaction') !== (b.satisfaction_score != null)) return reply.code(400).send({ error: 'satisfaction_score is required for (and only for) kind=satisfaction' });
    // Un signalement sensible (protection, abus) est au moins de gravité « high ».
    const severity = b.is_sensitive && (b.severity === 'low' || b.severity === 'medium') ? 'high' : b.severity;
    const received = b.received_at ? new Date(b.received_at) : new Date();
    const { ackDue, due } = sla(b.kind, severity, received);
    const id = randomUUID();                                   // pas de RETURNING : la RLS masquerait une ligne sensible à son auteur
    await run(req, async (c) => {
      await c.query(
        `INSERT INTO feedback (id, tenant_id, project_id, kind, channel, severity, subject, description, anonymous, submitter_contact, is_sensitive, satisfaction_score, location, received_at, ack_due_at, due_at, created_by)
         VALUES ($1, app.current_tenant(), $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, app.current_user_id())`,
        [id, b.project_id, b.kind, b.channel, severity, b.subject, b.description, b.anonymous, b.contact ?? null, b.is_sensitive, b.satisfaction_score ?? null, b.location ?? null, received, ackDue, due]);
      await c.query('INSERT INTO feedback_event (tenant_id, feedback_id, to_status, actor) VALUES (app.current_tenant(), $1, $2, app.current_user_id())', [id, 'received']);
    });
    return reply.code(201).send({ id, status: 'received', severity, ack_due_at: ackDue, due_at: due });
  });

  app.get('/feedback', { preHandler: guard(READ) }, async (req) => {
    const f = z.object({ project_id: Uuid.optional(), kind: z.enum(KINDS).optional(), status: z.enum(FB_STATUS).optional(), overdue_as_of: z.string().date().optional() }).parse(req.query);
    const rows = await run(req, async (c) => (await c.query(
      `SELECT ${COLS} FROM feedback WHERE ($1::uuid IS NULL OR project_id = $1) AND ($2::text IS NULL OR kind = $2) AND ($3::text IS NULL OR status = $3)
         AND ($4::date IS NULL OR (status NOT IN ('resolved','closed') AND due_at < $4::date))
       ORDER BY (severity = 'critical') DESC, (severity = 'high') DESC, received_at DESC LIMIT 300`,
      [f.project_id ?? null, f.kind ?? null, f.status ?? null, f.overdue_as_of ?? null])).rows);
    return rows.map((r) => mask(req, r));
  });

  app.get('/feedback/:id', { preHandler: guard(READ) }, async (req, reply) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const out = await run(req, async (c) => {
      const f = (await c.query(`SELECT ${COLS} FROM feedback WHERE id = $1`, [id])).rows[0];
      if (!f) return null;
      const events = (await c.query('SELECT from_status, to_status, actor, note, at FROM feedback_event WHERE feedback_id = $1 ORDER BY id', [id])).rows;
      return { ...f, events };
    });
    return out ? mask(req, out) : reply.code(404).send({ error: 'not found' });
  });

  app.post('/feedback/:id/transition', { preHandler: guard(HANDLE) }, async (req, reply) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const b = z.object({ to: z.enum(FB_STATUS), note: z.string().trim().min(3).max(4000).optional(), escalated_to: z.string().trim().min(2).optional(), complainant_satisfied: z.boolean().optional() }).parse(req.body);
    return run(req, async (c) => {
      const f = (await c.query('SELECT status, kind FROM feedback WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!f) return reply.code(404).send({ error: 'not found' });
      const allowed = f.kind === 'satisfaction' ? (f.status === 'received' ? ['closed'] : []) : NEXT[f.status];
      if (!allowed.includes(b.to)) return reply.code(409).send({ error: `invalid transition ${f.status} -> ${b.to}` });
      if (b.to === 'resolved' && (b.note?.length ?? 0) < 10) return reply.code(400).send({ error: 'resolution note (10+ chars) required' });
      if (b.to === 'escalated' && !b.escalated_to) return reply.code(400).send({ error: 'escalated_to required' });
      if (b.to === 'closed') {
        if (!isManager(req)) return reply.code(403).send({ error: 'only a manager can close' });
        if (NEEDS_SATISFACTION_CHECK.has(f.kind) && b.complainant_satisfied == null) return reply.code(400).send({ error: 'complainant_satisfied required to close a complaint' });
      }
      await c.query(
        `UPDATE feedback SET status = $2,
           acknowledged_at = CASE WHEN $2 = 'acknowledged' THEN now() ELSE acknowledged_at END,
           resolved_at = CASE WHEN $2 = 'resolved' THEN now() WHEN $2 = 'investigating' THEN NULL ELSE resolved_at END,
           resolution = CASE WHEN $2 = 'resolved' THEN $3 ELSE resolution END,
           escalation_level = escalation_level + CASE WHEN $2 = 'escalated' THEN 1 ELSE 0 END,
           escalated_to = CASE WHEN $2 = 'escalated' THEN $4 ELSE escalated_to END,
           complainant_satisfied = CASE WHEN $2 = 'closed' THEN $5 ELSE complainant_satisfied END,
           closed_at = CASE WHEN $2 = 'closed' THEN now() ELSE closed_at END
         WHERE id = $1`, [id, b.to, b.note ?? null, b.escalated_to ?? null, b.complainant_satisfied ?? null]);
      await c.query('INSERT INTO feedback_event (tenant_id, feedback_id, from_status, to_status, actor, note) VALUES (app.current_tenant(), $1,$2,$3, app.current_user_id(), $4)', [id, f.status, b.to, b.note ?? null]);
      return { id, from: f.status, to: b.to };
    });
  });

  // ---- Apprentissage ----
  app.post('/lessons', { preHandler: guard(INTAKE) }, async (req, reply) => {
    const b = z.object({ project_id: Uuid, category: z.enum(['lesson', 'good_practice', 'challenge', 'adaptation']), title: z.string().trim().min(3).max(300), description: z.string().trim().min(10).max(5000),
      recommendation: z.string().max(4000).optional(), decision: z.string().max(4000).optional(), tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]), result_id: Uuid.optional(), evaluation_id: Uuid.optional() }).parse(req.body);
    const row = await run(req, async (c) => (await c.query(
      `INSERT INTO lesson (tenant_id, project_id, category, title, description, recommendation, decision, tags, result_id, evaluation_id, created_by)
       VALUES (app.current_tenant(),$1,$2,$3,$4,$5,$6,$7,$8,$9, app.current_user_id()) RETURNING id, status`,
      [b.project_id, b.category, b.title, b.description, b.recommendation ?? null, b.decision ?? null, b.tags, b.result_id ?? null, b.evaluation_id ?? null])).rows[0]);
    return reply.code(201).send(row);
  });

  app.post('/lessons/:id/transition', { preHandler: guard(HANDLE) }, async (req, reply) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const { to } = z.object({ to: z.enum(['draft', 'validated', 'published']) }).parse(req.body);
    if (to === 'published' && !isManager(req)) return reply.code(403).send({ error: 'only a manager can publish' });
    const row = await run(req, async (c) => (await c.query('UPDATE lesson SET status = $2 WHERE id = $1 RETURNING id, status, validated_by', [id, to])).rows[0]);
    return row ?? reply.code(404).send({ error: 'not found' });
  });

  app.get('/lessons', { preHandler: guard(READ) }, async (req) => {
    const f = z.object({ project_id: Uuid.optional(), category: z.enum(['lesson', 'good_practice', 'challenge', 'adaptation']).optional(), status: z.enum(['draft', 'validated', 'published']).optional(),
      tag: z.string().optional(), q: z.string().optional() }).parse(req.query);
    return run(req, async (c) => (await c.query(
      `SELECT id, project_id, category, title, description, recommendation, decision, tags, status, created_by, validated_by FROM lesson
       WHERE ($1::uuid IS NULL OR project_id = $1) AND ($2::text IS NULL OR category = $2) AND ($3::text IS NULL OR status = $3)
         AND ($4::text IS NULL OR $4 = ANY(tags)) AND ($5::text IS NULL OR app.norm_text(title || ' ' || description) LIKE '%' || app.norm_text($5) || '%')
         AND (status = 'published' OR $6::boolean)            -- brouillons/validées : réservés aux rôles de revue
       ORDER BY created_at DESC LIMIT 200`,
      [f.project_id ?? null, f.category ?? null, f.status ?? null, f.tag ?? null, f.q ?? null, (req as any).principal.roles.some((r: string) => [...MANAGE, 'reviewer', 'data_entry'].includes(r))])).rows);
  });

  // Synthèse MEAL (alimente le dashboard MEAL et le copilote). as_of pour des résultats reproductibles.
  app.get('/meal/summary', { preHandler: guard(READ) }, async (req) => {
    const f = z.object({ project_id: Uuid.optional(), as_of: z.string().date().optional() }).parse(req.query);
    const asOf = f.as_of ?? new Date().toISOString().slice(0, 10);
    return run(req, async (c) => {
      const p = [f.project_id ?? null, asOf];
      const one = async (sql: string) => (await c.query(sql, sql.includes('$2') ? p : [p[0]])).rows;   // pg refuse les paramètres inutilisés
      const [kindStatus, overdue, ackOverdue, sat, res, lessons] = await Promise.all([
        one(`SELECT kind, status, count(*)::int AS n FROM feedback WHERE ($1::uuid IS NULL OR project_id = $1) GROUP BY kind, status ORDER BY kind, status`),
        one(`SELECT count(*)::int AS n FROM feedback WHERE ($1::uuid IS NULL OR project_id = $1) AND status NOT IN ('resolved','closed') AND due_at < $2::date`),
        one(`SELECT count(*)::int AS n FROM feedback WHERE ($1::uuid IS NULL OR project_id = $1) AND acknowledged_at IS NULL AND status = 'received' AND ack_due_at < $2::date`),
        one(`SELECT round(avg(satisfaction_score)::numeric, 2)::float8 AS avg, count(*)::int AS n FROM feedback WHERE ($1::uuid IS NULL OR project_id = $1) AND kind = 'satisfaction'`),
        one(`SELECT round(avg(extract(epoch FROM (resolved_at - received_at)) / 86400)::numeric, 1)::float8 AS avg_days, count(*)::int AS n FROM feedback WHERE ($1::uuid IS NULL OR project_id = $1) AND resolved_at IS NOT NULL`),
        one(`SELECT category, status, count(*)::int AS n FROM lesson WHERE ($1::uuid IS NULL OR project_id = $1) GROUP BY category, status ORDER BY category, status`),
      ]);
      return { as_of: asOf, feedback_by_kind_status: kindStatus, overdue_resolution: overdue[0].n, overdue_acknowledgement: ackOverdue[0].n,
        satisfaction: sat[0], resolution: res[0], lessons: lessons };
    });
  });
}
