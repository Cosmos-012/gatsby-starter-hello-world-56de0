import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type pg from 'pg';
import { withTenant } from './db.ts';
import { buildOverview } from './dashboard.ts';
import { trackingRows } from './tracking.ts';
import { followUp } from './evaluations.ts';
import { buildContent, hashContent, REPORT_TYPES, type Content } from './report-content.ts';
import { renderHtml, renderXlsx } from './report-render.ts';
import { parseLangs } from './i18n.ts';
import { canTransition, transitionExists, type State } from './workflow.ts';

const MANAGE = ['admin', 'me_manager'];
const GENERATE = [...MANAGE, 'reviewer'];
const READ = [...MANAGE, 'reviewer', 'data_entry', 'viewer'];
const STATES = ['draft', 'submitted', 'review', 'validated', 'approved', 'published', 'archived'] as const;
const Uuid = z.string().uuid();
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function registerReports(app: FastifyInstance, pool: pg.Pool) {
  const guard = (roles: string[]) => async (req: any, reply: any) => {
    if (!req.principal.roles.some((r: string) => roles.includes(r))) return reply.code(403).send({ error: 'forbidden' });
  };
  // Les brouillons et rapports en cours de revue ne sont visibles que des rôles de gestion/revue ; les autres ne voient que le publié.
  const canSeeDrafts = (req: any) => req.principal.roles.some((r: string) => GENERATE.includes(r));
  const visible = (req: any, status: string) => canSeeDrafts(req) || status === 'published' || status === 'archived';

  app.post('/reports', { preHandler: guard(GENERATE) }, async (req, reply) => {
    const b = z.object({ project_id: Uuid.optional(), type: z.enum(REPORT_TYPES as [string, ...string[]]), title: z.string().trim().min(3).max(300).optional(),
      period_start: z.string().date(), period_end: z.string().date(), as_of: z.string().date().optional() }).parse(req.body);
    if (b.period_end < b.period_start) return reply.code(400).send({ error: 'period_end before period_start' });
    const asOf = b.as_of ?? b.period_end;
    const p = (req as any).principal;
    const row = await withTenant(pool, p, async (c) => {
      const overview = await buildOverview(c, { project_id: b.project_id, as_of: asOf, period_end: b.period_end });
      const indicators = await trackingRows(c, { project_id: b.project_id, periodEnd: b.period_end, dimensions: {} });
      const dqIssues = (await c.query(
        `SELECT i.code AS indicator_code, d.indicator_id, d.period, d.dimension, d.severity, d.message
         FROM dq_issue d JOIN indicator i ON i.tenant_id = d.tenant_id AND i.id = d.indicator_id
         WHERE d.status = 'open' AND ($1::uuid IS NULL OR i.project_id = $1) ORDER BY (d.severity = 'error') DESC, i.code, d.period`, [b.project_id ?? null])).rows;
      const risks = (await c.query(
        `SELECT id, code, title, level, score, status, owner_name, escalation_level FROM risk
         WHERE status IN ('open','mitigating','accepted') AND ($1::uuid IS NULL OR project_id = $1) ORDER BY score DESC, code`, [b.project_id ?? null])).rows;
      const fu = await followUp(c, b.project_id, asOf);
      const q = (extra: Record<string, string>) => new URLSearchParams({ ...(b.project_id ? { project_id: b.project_id } : {}), ...extra }).toString();
      const meta = { type: b.type as any, title: b.title ?? `${b.type} ${b.period_end}`, project_id: b.project_id ?? null, period_start: b.period_start, period_end: b.period_end, as_of: asOf, generated_at: new Date().toISOString() };
      const content = buildContent(meta, { overview, indicators, dqIssues, overdueActions: fu.overdue_actions, risks, risksSource: `/risks?${q({ as_of: asOf })}`,
        indicatorsSource: `/indicators/tracking?${q({ period_end: b.period_end })}`, dqSource: `/dqa/issues?${q({ status: 'open' })}`, actionsSource: `/recommendations/follow-up?${q({ as_of: asOf })}` });
      const hash = hashContent(content);
      const version = (await c.query(
        `SELECT COALESCE(max(version), 0) + 1 AS v FROM report WHERE COALESCE(project_id::text, '') = $1 AND type = $2 AND period_end = $3`, [b.project_id ?? '', b.type, b.period_end])).rows[0].v;
      return (await c.query(
        `INSERT INTO report (tenant_id, project_id, type, title, period_start, period_end, as_of, version, content, content_hash, generated_by)
         VALUES (app.current_tenant(), $1,$2,$3,$4,$5,$6,$7,$8,$9, app.current_user_id()) RETURNING id, version, status, content_hash`,
        [b.project_id ?? null, b.type, meta.title, b.period_start, b.period_end, asOf, version, content, hash])).rows[0];
    });
    return reply.code(201).send(row);
  });

  app.get('/reports', { preHandler: guard(READ) }, async (req) => {
    const f = z.object({ project_id: Uuid.optional(), type: z.enum(REPORT_TYPES as [string, ...string[]]).optional(), status: z.enum(STATES).optional() }).parse(req.query);
    return withTenant(pool, (req as any).principal, async (c) => (await c.query(
      `SELECT id, project_id, type, title, period_start::text AS period_start, period_end::text AS period_end, as_of::text AS as_of, version, status, content_hash, generated_by, generated_at FROM report
       WHERE ($1::uuid IS NULL OR project_id = $1) AND ($2::text IS NULL OR type = $2) AND ($3::text IS NULL OR status = $3)
         AND (status IN ('published','archived') OR $4::boolean)
       ORDER BY period_end DESC, type, version DESC LIMIT 200`, [f.project_id ?? null, f.type ?? null, f.status ?? null, canSeeDrafts(req)])).rows);
  });

  const load = (req: any, id: string) => withTenant(pool, req.principal, async (c) => {
    const r = (await c.query('SELECT id, project_id, type, title, period_start::text AS period_start, period_end::text AS period_end, as_of::text AS as_of, version, status, content, content_hash, generated_by, generated_at FROM report WHERE id = $1', [id])).rows[0];
    if (!r || !visible(req, r.status)) return null;
    const events = (await c.query('SELECT from_status, to_status, actor, comment, at FROM report_event WHERE report_id = $1 ORDER BY id', [id])).rows;
    return { ...r, events };
  });

  app.get('/reports/:id', { preHandler: guard(READ) }, async (req, reply) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    return (await load(req, id)) ?? reply.code(404).send({ error: 'not found' });
  });

  // Vérification d'intégrité : l'empreinte stockée doit correspondre au contenu stocké.
  app.get('/reports/:id/verify', { preHandler: guard(READ) }, async (req, reply) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const r = await load(req, id);
    if (!r) return reply.code(404).send({ error: 'not found' });
    const actual = hashContent(r.content as Content);
    return { id, valid: actual === r.content_hash, stored_hash: r.content_hash, computed_hash: actual };
  });

  app.get('/reports/:id/export', { preHandler: guard(READ) }, async (req, reply) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const q = z.object({ format: z.enum(['json', 'xlsx', 'html']).default('json'), lang: z.string().optional() }).parse(req.query);
    const r = await load(req, id);
    if (!r) return reply.code(404).send({ error: 'not found' });
    if (hashContent(r.content) !== r.content_hash) return reply.code(409).send({ error: 'report integrity check failed' });   // jamais d'export d'un contenu altéré
    const langs = parseLangs(q.lang);
    const name = `report-${r.type}-${r.period_end}-v${r.version}`;
    if (q.format === 'xlsx') return reply.header('content-type', XLSX_MIME).header('content-disposition', `attachment; filename="${name}.xlsx"`).send(await renderXlsx(r.content, r.content_hash, r.version, langs));
    if (q.format === 'html') return reply.header('content-type', 'text/html; charset=utf-8').header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'").send(renderHtml(r.content, r.content_hash, r.version, langs));
    return reply.header('content-disposition', `attachment; filename="${name}.json"`).send({ id, version: r.version, status: r.status, content_hash: r.content_hash, content: r.content });
  });

  app.post('/reports/:id/transition', { preHandler: guard(READ) }, async (req, reply) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const b = z.object({ to: z.enum(STATES), comment: z.string().trim().max(2000).optional() }).parse(req.body);
    return withTenant(pool, (req as any).principal, async (c) => {
      const cur = (await c.query('SELECT status FROM report WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!cur || !visible(req, cur.status)) return reply.code(404).send({ error: 'not found' });
      const from = cur.status as State;
      if (!transitionExists(from, b.to as State)) return reply.code(409).send({ error: `invalid transition ${from} -> ${b.to}` });
      // Le rôle qui génère un rapport (revue incluse) peut aussi le soumettre ; le reste suit le graphe commun.
      const roles: string[] = (req as any).principal.roles;
      const allowed = from === 'draft' && b.to === 'submitted' ? roles.some((r) => GENERATE.includes(r)) : canTransition(from, b.to as State, roles);
      if (!allowed) return reply.code(403).send({ error: 'forbidden' });
      await c.query("SELECT set_config('app.comment', $1, true)", [b.comment ?? '']);   // lu par le déclencheur : le journal reste en ajout seul
      await c.query('UPDATE report SET status = $2 WHERE id = $1', [id, b.to]);
      return { id, from, to: b.to };
    });
  });
}
