import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type pg from 'pg';
import { withTenant } from './db.ts';
import type { Storage } from './storage.ts';

const READ = ['admin', 'me_manager', 'data_entry', 'reviewer', 'viewer'];
const WRITE = ['admin', 'me_manager', 'data_entry'];
const MANAGE = ['admin', 'me_manager'];
export const MAX_BYTES = 25 * 1024 * 1024;
export const ALLOWED_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/csv', 'text/plain', 'application/json',
  'application/vnd.ms-excel', 'application/msword',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const Uuid = z.string().uuid();
const KINDS = ['photo', 'report', 'dataset', 'survey', 'certificate', 'attendance', 'document', 'evaluation_report', 'supporting', 'url'] as const;
const Target = z.object({ indicator_value_id: Uuid.optional(), indicator_id: Uuid.optional(), result_id: Uuid.optional() })
  .refine((t) => Object.values(t).filter(Boolean).length === 1, 'exactly one target required');

/** Nom de fichier sûr (aucun chemin, caractères Unicode lettres/chiffres conservés pour l'arabe). */
export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const s = base.normalize('NFC').replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^[._]+/, '').slice(0, 120);
  return s || 'file';
}

export function registerEvidence(app: FastifyInstance, pool: pg.Pool, storage: Storage) {
  const guard = (roles: string[]) => async (req: any, reply: any) => {
    if (!req.principal.roles.some((r: string) => roles.includes(r))) return reply.code(403).send({ error: 'forbidden' });
  };
  const COLS = `e.id, e.project_id, e.kind, e.title, e.filename, e.content_type, e.size_bytes, e.sha256, e.url, e.latitude::float8 AS latitude, e.longitude::float8 AS longitude, e.captured_at, e.status, e.uploaded_by`;
  const linkSql = `INSERT INTO evidence_link (tenant_id, evidence_id, indicator_value_id, indicator_id, result_id, linked_by)
                   VALUES (app.current_tenant(), $1, $2, $3, $4, app.current_user_id())`;

  app.post('/evidence', { preHandler: guard(WRITE) }, async (req, reply) => {
    const b = z.object({
      project_id: Uuid, kind: z.enum(KINDS), title: z.string().trim().min(1).max(300),
      filename: z.string().min(1).max(255).optional(), content_type: z.string().optional(),
      size_bytes: z.number().int().positive().max(MAX_BYTES).optional(), sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
      url: z.string().url().refine((u) => /^https?:\/\//i.test(u), 'http(s) only').optional(),
      latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional(),
      captured_at: z.string().datetime().optional(), link: Target.optional(),
    }).parse(req.body);
    const p = (req as any).principal;
    const isUrl = b.kind === 'url';
    if (isUrl !== !!b.url) return reply.code(400).send({ error: isUrl ? 'url required for kind=url' : 'url only allowed for kind=url' });
    if (!isUrl && (!b.filename || !b.size_bytes || !b.content_type)) return reply.code(400).send({ error: 'filename, content_type and size_bytes required' });
    if (!isUrl && !ALLOWED_TYPES.has(b.content_type!)) return reply.code(415).send({ error: `content type not allowed: ${b.content_type}` });
    if ((b.latitude == null) !== (b.longitude == null)) return reply.code(400).send({ error: 'latitude and longitude go together' });

    const id = randomUUID();
    const filename = isUrl ? null : safeFilename(b.filename!);
    const key = isUrl ? null : `${p.tenantId}/${id}/${filename}`;     // jamais dérivé d'un chemin client
    await withTenant(pool, p, async (c) => {
      await c.query(
        `INSERT INTO evidence (id, tenant_id, project_id, kind, title, filename, content_type, size_bytes, sha256, storage_key, url, latitude, longitude, captured_at, status, uploaded_by)
         VALUES ($1, app.current_tenant(), $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, app.current_user_id())`,
        [id, b.project_id, b.kind, b.title, filename, isUrl ? null : b.content_type, b.size_bytes ?? null, b.sha256 ?? null, key, b.url ?? null,
         b.latitude ?? null, b.longitude ?? null, b.captured_at ?? null, isUrl ? 'available' : 'pending']);
      if (b.link) await c.query(linkSql, [id, b.link.indicator_value_id ?? null, b.link.indicator_id ?? null, b.link.result_id ?? null]);
    });
    const upload = isUrl ? null : await storage.presignPut(key!, { contentType: b.content_type!, size: b.size_bytes!, sha256Hex: b.sha256 });
    return reply.code(201).send({ id, status: isUrl ? 'available' : 'pending', upload });
  });

  // Confirmation : l'objet doit exister dans le stockage avec la taille déclarée.
  app.post('/evidence/:id/complete', { preHandler: guard(WRITE) }, async (req, reply) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const p = (req as any).principal;
    return withTenant(pool, p, async (c) => {
      const e = (await c.query('SELECT status, storage_key, size_bytes::float8 AS size, uploaded_by FROM evidence WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!e) return reply.code(404).send({ error: 'not found' });
      if (e.uploaded_by !== p.sub && !p.roles.some((r: string) => MANAGE.includes(r))) return reply.code(403).send({ error: 'forbidden' });
      if (e.status === 'available') return { id, status: 'available' };
      const head = await storage.head(e.storage_key);
      if (!head) return reply.code(409).send({ error: 'file not uploaded yet' });
      if (head.size !== e.size) return reply.code(409).send({ error: `size mismatch: declared ${e.size}, stored ${head.size}` });
      await c.query("UPDATE evidence SET status = 'available' WHERE id = $1", [id]);
      return { id, status: 'available' };
    });
  });

  app.post('/evidence/:id/links', { preHandler: guard(WRITE) }, async (req, reply) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const t = Target.parse(req.body);
    await withTenant(pool, (req as any).principal, async (c) => c.query(linkSql, [id, t.indicator_value_id ?? null, t.indicator_id ?? null, t.result_id ?? null]));
    return reply.code(201).send({ ok: true });
  });

  app.get('/evidence', { preHandler: guard(READ) }, async (req) => {
    const f = z.object({ project_id: Uuid.optional(), indicator_id: Uuid.optional(), indicator_value_id: Uuid.optional(), status: z.enum(['pending', 'available']).optional() }).parse(req.query);
    return withTenant(pool, (req as any).principal, async (c) => (await c.query(
      `SELECT ${COLS} FROM evidence e
       WHERE ($1::uuid IS NULL OR e.project_id = $1) AND ($4::text IS NULL OR e.status = $4)
         AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM evidence_link l WHERE l.evidence_id = e.id AND l.indicator_id = $2))
         AND ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM evidence_link l WHERE l.evidence_id = e.id AND l.indicator_value_id = $3))
       ORDER BY e.created_at DESC LIMIT 200`, [f.project_id ?? null, f.indicator_id ?? null, f.indicator_value_id ?? null, f.status ?? null])).rows);
  });

  app.get('/evidence/:id/download', { preHandler: guard(READ) }, async (req, reply) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const e = await withTenant(pool, (req as any).principal, async (c) =>
      (await c.query('SELECT status, storage_key, filename, url FROM evidence WHERE id = $1', [id])).rows[0]);
    if (!e) return reply.code(404).send({ error: 'not found' });
    if (e.status !== 'available') return reply.code(409).send({ error: 'file not available' });
    return e.url ? { url: e.url } : { url: await storage.presignGet(e.storage_key, e.filename) };
  });

  // Chaîne complète : Preuve → Donnée → Indicateur → Output → Outcome → Impact → Projet.
  app.get('/indicator-values/:id/chain', { preHandler: guard(READ) }, async (req, reply) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    return withTenant(pool, (req as any).principal, async (c) => {
      const v = (await c.query(
        `SELECT v.id, v.period, v.kind, v.value::float8 AS value, v.workflow_state, v.indicator_id,
                i.code AS indicator_code, i.result_id, i.project_id, pr.code AS project_code
         FROM indicator_value v JOIN indicator i ON i.tenant_id = v.tenant_id AND i.id = v.indicator_id
         JOIN project pr ON pr.tenant_id = i.tenant_id AND pr.id = i.project_id WHERE v.id = $1`, [id])).rows[0];
      if (!v) return reply.code(404).send({ error: 'not found' });
      const results = v.result_id ? (await c.query(
        `WITH RECURSIVE up AS (
           SELECT id, parent_id, level, code, name, 0 AS depth FROM result WHERE id = $1
           UNION ALL SELECT r.id, r.parent_id, r.level, r.code, r.name, up.depth + 1 FROM result r JOIN up ON r.id = up.parent_id)
         SELECT level, code, name FROM up ORDER BY depth`, [v.result_id])).rows : [];
      // Une preuve liée à la fois à la donnée et à l'indicateur n'apparaît qu'une fois ; 'value' prime.
      const evidence = (await c.query(
        `SELECT ${COLS}, CASE WHEN bool_or(l.indicator_value_id = $1) THEN 'value' ELSE 'indicator' END AS linked_at
         FROM evidence e JOIN evidence_link l ON l.evidence_id = e.id AND (l.indicator_value_id = $1 OR l.indicator_id = $2)
         WHERE e.status = 'available' GROUP BY e.tenant_id, e.id ORDER BY e.created_at`, [id, v.indicator_id])).rows;
      return { value: { id: v.id, period: v.period, kind: v.kind, value: v.value, state: v.workflow_state },
        indicator: { id: v.indicator_id, code: v.indicator_code }, results, project: { id: v.project_id, code: v.project_code }, evidence };
    });
  });
}
