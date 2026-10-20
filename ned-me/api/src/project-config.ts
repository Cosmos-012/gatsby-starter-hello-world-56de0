import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type pg from 'pg';
import { withTenant } from './db.ts';

const Uuid = z.guid();
const Lang = z.object({ fr: z.string().min(1).max(200).optional(), ar: z.string().min(1).max(200).optional(), en: z.string().min(1).max(200).optional() })
  .refine((n) => n.fr || n.ar || n.en, 'au moins une langue');
type Label = z.infer<typeof Lang>;

/** Modules du produit. `core` : toujours actifs. `built:false` : annoncés mais pas encore construits (jamais présentés comme fonctionnels). */
export const MODULES = {
  results: { core: true, built: true }, indicators: { core: true, built: true },
  dqa: { built: true }, evidence: { built: true }, evaluations: { built: true }, meal: { built: true }, risks: { built: true }, reports: { built: true },
  activities: { built: false }, finance: { built: false }, procurement: { built: false }, collection: { built: false }, gis: { built: false }, ai: { built: false },
} as const;
export type ModuleKey = keyof typeof MODULES;
const MODULE_KEYS = Object.keys(MODULES) as ModuleKey[];

export const WIDGETS = ['kpi_overall', 'kpi_coverage', 'kpi_dq', 'kpi_at_risk', 'status', 'levels', 'alerts', 'evaluations', 'accountability', 'risks', 'learning'] as const;
/** Un widget dépend d'un module : désactivé avec lui. */
export const WIDGET_MODULE: Partial<Record<(typeof WIDGETS)[number], ModuleKey>> = { kpi_dq: 'dqa', evaluations: 'evaluations', accountability: 'meal', learning: 'meal', risks: 'risks' };

const LEVELS = ['impact', 'outcome', 'output'] as const;
const FieldDef = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/), type: z.enum(['text', 'number', 'select', 'date', 'boolean']), label: Lang,
  required: z.boolean().default(false),
  options: z.array(z.object({ value: z.string().regex(/^[a-z0-9_]{1,40}$/), label: Lang })).min(2).max(50).optional(),
}).refine((f) => (f.type === 'select') === (f.options !== undefined), 'options requises pour select (et seulement pour select)');
export type FieldDef = z.infer<typeof FieldDef>;

const Modules = z.partialRecord(z.enum(MODULE_KEYS as [ModuleKey, ...ModuleKey[]]), z.boolean());
const Terminology = z.object({ level_labels: z.object({ impact: Lang, outcome: Lang, output: Lang }).partial().optional() }).strict();
const Dashboard = z.object({ widgets: z.array(z.object({ id: z.enum(WIDGETS), visible: z.boolean() })).max(WIDGETS.length) }).strict();
const CustomFields = z.array(FieldDef).max(40).superRefine((a, ctx) => {
  const seen = new Set<string>();
  for (const f of a) { if (seen.has(f.key)) ctx.addIssue({ code: 'custom', message: `clé en double : ${f.key}` }); seen.add(f.key); }
});

export interface Config {
  template: string; modules: Record<ModuleKey, boolean>; terminology: { level_labels: Partial<Record<(typeof LEVELS)[number], Label>> };
  dashboard: { widgets: { id: (typeof WIDGETS)[number]; visible: boolean }[] }; custom_fields: FieldDef[]; version: number;
}

const L = (fr: string, en: string, ar: string): Label => ({ fr, en, ar });
const BASE_MODULES: Record<ModuleKey, boolean> = {
  results: true, indicators: true, dqa: true, evidence: true, evaluations: true, meal: true, risks: true, reports: true,
  activities: true, finance: true, procurement: true, collection: false, gis: false, ai: false,   // true pour un module non construit = « pas encore disponible » affiché
};
export interface Template { id: string; label: Label; modules?: Partial<Record<ModuleKey, boolean>>; level_labels?: Config['terminology']['level_labels']; custom_fields?: FieldDef[] }
const sel = (key: string, label: Label, options: [string, Label][], required = false): FieldDef => ({ key, type: 'select', label, required, options: options.map(([value, label]) => ({ value, label })) });
/** Points de départ structurels : aucun chiffre, aucune cible. À adapter ensuite projet par projet. */
export const TEMPLATES: Template[] = [
  { id: 'generic', label: L('Projet générique', 'Generic project', 'مشروع عام') },
  { id: 'health', label: L('Santé', 'Health', 'الصحة'), modules: { gis: true },
    level_labels: { impact: L('Impact sanitaire', 'Health impact', 'الأثر الصحي'), outcome: L('Résultat de santé', 'Health outcome', 'النتيجة الصحية'), output: L('Prestation de services', 'Service delivery', 'تقديم الخدمات') },
    custom_fields: [sel('facility_level', L('Niveau de la structure', 'Facility level', 'مستوى المنشأة'), [['community', L('Communautaire', 'Community', 'مجتمعي')], ['primary', L('Soins primaires', 'Primary care', 'رعاية أولية')], ['referral', L('Référence', 'Referral', 'إحالة')]])] },
  { id: 'education', label: L('Éducation', 'Education', 'التعليم'),
    level_labels: { impact: L('Impact éducatif', 'Education impact', 'الأثر التعليمي'), outcome: L('Acquis', 'Learning outcome', 'مخرجات التعلّم'), output: L('Offre éducative', 'Education delivery', 'الخدمات التعليمية') },
    custom_fields: [sel('school_cycle', L('Cycle', 'Cycle', 'المرحلة'), [['primary', L('Primaire', 'Primary', 'ابتدائي')], ['secondary', L('Secondaire', 'Secondary', 'ثانوي')], ['tvet', L('Formation professionnelle', 'Vocational', 'مهني')]])] },
  { id: 'infrastructure', label: L('Infrastructure', 'Infrastructure', 'البنية التحتية'), modules: { gis: true, procurement: true, finance: true },
    level_labels: { outcome: L('Bénéfice', 'Benefit', 'المنفعة'), output: L('Ouvrage livré', 'Asset delivered', 'المنشأة المنجزة') },
    custom_fields: [{ key: 'contract_ref', type: 'text', label: L('Référence du marché', 'Contract reference', 'مرجع العقد'), required: false }] },
  { id: 'humanitarian', label: L('Humanitaire', 'Humanitarian', 'إنساني'), modules: { collection: true },
    level_labels: { impact: L('Objectif stratégique', 'Strategic objective', 'الهدف الاستراتيجي'), outcome: L('Objectif spécifique', 'Specific objective', 'الهدف المحدد'), output: L('Assistance fournie', 'Assistance delivered', 'المساعدة المقدمة') },
    custom_fields: [sel('cluster', L('Secteur / cluster', 'Sector / cluster', 'القطاع'), [['health', L('Santé', 'Health', 'الصحة')], ['wash', L('Eau et assainissement', 'Water and sanitation', 'المياه والإصحاح')], ['protection', L('Protection', 'Protection', 'الحماية')], ['food', L('Sécurité alimentaire', 'Food security', 'الأمن الغذائي')]])] },
  { id: 'agriculture', label: L('Agriculture', 'Agriculture', 'الزراعة'), modules: { gis: true },
    level_labels: { outcome: L('Productivité et revenus', 'Productivity and income', 'الإنتاجية والدخل'), output: L('Services agricoles', 'Agricultural services', 'الخدمات الزراعية') },
    custom_fields: [{ key: 'value_chain', type: 'text', label: L('Filière', 'Value chain', 'سلسلة القيمة'), required: false }] },
];
const DEFAULT_WIDGETS = WIDGETS.map((id) => ({ id, visible: true }));

export const templateById = (id: string) => TEMPLATES.find((t) => t.id === id);
export function fromTemplate(id: string): Config {
  const t = templateById(id) ?? TEMPLATES[0];
  return { template: t.id, modules: { ...BASE_MODULES, ...t.modules }, terminology: { level_labels: { ...t.level_labels } }, dashboard: { widgets: DEFAULT_WIDGETS.map((w) => ({ ...w })) },
    custom_fields: structuredClone(t.custom_fields ?? []), version: 0 };
}
/** Configuration effective = modèle + ce qui est enregistré. Les modules de base restent actifs quoi qu'il y ait en base ; les widgets inconnus sont ignorés, les manquants ajoutés visibles. */
export function effective(row: { template: string; modules: any; terminology: any; dashboard: any; custom_fields: any; version: number } | null | undefined): Config {
  if (!row) return fromTemplate('generic');
  const c = fromTemplate(row.template);
  for (const k of MODULE_KEYS) if (typeof row.modules?.[k] === 'boolean') c.modules[k] = row.modules[k];
  for (const k of MODULE_KEYS) if ('core' in MODULES[k]) c.modules[k] = true;
  if (row.terminology?.level_labels) c.terminology.level_labels = row.terminology.level_labels;
  const stored: { id: string; visible: boolean }[] = Array.isArray(row.dashboard?.widgets) ? row.dashboard.widgets : [];
  const known = stored.filter((w) => (WIDGETS as readonly string[]).includes(w.id)) as Config['dashboard']['widgets'];
  c.dashboard.widgets = [...known, ...WIDGETS.filter((id) => !known.some((w) => w.id === id)).map((id) => ({ id, visible: true }))];
  if (Array.isArray(row.custom_fields)) c.custom_fields = row.custom_fields;
  c.version = row.version;
  return c;
}
/** Modules annoncés (activés) mais pas encore construits : affichés comme « pas encore disponibles », jamais comme des zéros. */
export const pendingModules = (c: Config) => MODULE_KEYS.filter((k) => !MODULES[k].built && c.modules[k]);
/** Un widget est visible si demandé ET si son module est actif. */
export const visibleWidgets = (c: Config) => c.dashboard.widgets.filter((w) => w.visible && (!WIDGET_MODULE[w.id] || c.modules[WIDGET_MODULE[w.id]!])).map((w) => w.id);

/** Valide les valeurs des champs personnalisés d'un indicateur contre la définition du projet. Retourne la liste des erreurs. */
export function validateAttributes(defs: FieldDef[], attrs: Record<string, unknown>): string[] {
  const errs: string[] = [];
  const byKey = new Map(defs.map((d) => [d.key, d]));
  for (const k of Object.keys(attrs)) if (!byKey.has(k)) errs.push(`champ inconnu : ${k}`);
  for (const d of defs) {
    const v = attrs[d.key];
    if (v === undefined || v === null || v === '') { if (d.required) errs.push(`champ requis : ${d.key}`); continue; }
    if (d.type === 'text' && (typeof v !== 'string' || v.length > 500)) errs.push(`${d.key} : texte (500 max)`);
    if (d.type === 'number' && !(typeof v === 'number' && Number.isFinite(v))) errs.push(`${d.key} : nombre`);
    if (d.type === 'boolean' && typeof v !== 'boolean') errs.push(`${d.key} : booléen`);
    if (d.type === 'select' && !d.options!.some((o) => o.value === v)) errs.push(`${d.key} : valeur hors liste`);
    if (d.type === 'date') {
      const ok = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
      if (!ok) errs.push(`${d.key} : date AAAA-MM-JJ`);
    }
  }
  return errs;
}

export async function loadConfig(c: pg.PoolClient, projectId: string | null | undefined): Promise<Config> {
  if (!projectId) return fromTemplate('generic');
  const { rows } = await c.query('SELECT template, modules, terminology, dashboard, custom_fields, version FROM project_config WHERE project_id = $1', [projectId]);
  return effective(rows[0]);
}

const WRITE = ['admin', 'me_manager'];
const READ = [...WRITE, 'data_entry', 'reviewer', 'viewer'];

export function registerProjectConfig(app: FastifyInstance, pool: pg.Pool) {
  const guard = (roles: string[]) => async (req: any, reply: any) => {
    if (!req.principal.roles.some((r: string) => roles.includes(r))) return reply.code(403).send({ error: 'forbidden' });
  };
  const exists = async (c: pg.PoolClient, id: string) => (await c.query('SELECT 1 FROM project WHERE id = $1', [id])).rowCount === 1;

  app.get('/config/templates', { preHandler: guard(READ) }, async () => ({
    modules: MODULE_KEYS.map((k) => ({ key: k, core: 'core' in MODULES[k], built: MODULES[k].built })), widgets: WIDGETS,
    templates: TEMPLATES.map((t) => ({ id: t.id, label: t.label })),
  }));

  app.get('/projects/:id/config', { preHandler: guard(READ) }, async (req, reply) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    return withTenant(pool, (req as any).principal, async (c) => (await exists(c, id)) ? loadConfig(c, id) : reply.code(404).send({ error: 'not_found' }));
  });

  // Enregistrement partiel : seuls les blocs fournis changent. `version` (optimiste) évite d'écraser la modification d'un collègue.
  app.put('/projects/:id/config', { preHandler: guard(WRITE) }, async (req, reply) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const b = z.object({ template: z.string().regex(/^[a-z_]{2,40}$/).optional(), modules: Modules.optional(), terminology: Terminology.optional(),
      dashboard: Dashboard.optional(), custom_fields: CustomFields.optional(), expected_version: z.number().int().min(0) }).strict().parse(req.body);
    if (b.template && !templateById(b.template)) return reply.code(400).send({ error: 'unknown_template' });
    if (b.modules) for (const k of MODULE_KEYS) if ('core' in MODULES[k] && b.modules[k] === false) return reply.code(400).send({ error: 'core_module', module: k });
    return withTenant(pool, (req as any).principal, async (c) => {
      if (!(await exists(c, id))) return reply.code(404).send({ error: 'not_found' });
      const cur = await loadConfig(c, id);
      if (cur.version !== b.expected_version) return reply.code(409).send({ error: 'version_conflict', current: cur.version });
      // Retirer un champ personnalisé ne doit pas rendre invalides les valeurs déjà saisies : on refuse tant qu'une valeur existe.
      if (b.custom_fields) {
        const removed = cur.custom_fields.map((f) => f.key).filter((k) => !b.custom_fields!.some((f) => f.key === k));
        for (const k of removed) {
          const { rowCount } = await c.query('SELECT 1 FROM indicator WHERE project_id = $1 AND attributes ? $2 LIMIT 1', [id, k]);
          if (rowCount) return reply.code(409).send({ error: 'field_in_use', key: k });
        }
      }
      const next = { template: b.template ?? cur.template, modules: b.modules ? { ...cur.modules, ...b.modules } : cur.modules, terminology: b.terminology ?? cur.terminology,
        dashboard: b.dashboard ?? cur.dashboard, custom_fields: b.custom_fields ?? cur.custom_fields };
      await c.query(`INSERT INTO project_config (tenant_id, project_id, template, modules, terminology, dashboard, custom_fields, version, updated_by)
        VALUES (app.current_tenant(), $1, $2, $3, $4, $5, $6, 1, app.current_user_id())
        ON CONFLICT (tenant_id, project_id) DO UPDATE SET template = EXCLUDED.template, modules = EXCLUDED.modules, terminology = EXCLUDED.terminology,
          dashboard = EXCLUDED.dashboard, custom_fields = EXCLUDED.custom_fields, version = project_config.version + 1, updated_at = now(), updated_by = EXCLUDED.updated_by`,
        [id, next.template, next.modules, next.terminology, next.dashboard, JSON.stringify(next.custom_fields)]);
      return loadConfig(c, id);
    });
  });

  // Applique un modèle : remplace tout le bloc (modules, terminologie, tableau de bord, champs). Refusé si des valeurs de champs personnalisés existent déjà et disparaîtraient.
  app.post('/projects/:id/config/apply-template', { preHandler: guard(WRITE) }, async (req, reply) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const b = z.object({ template: z.string().regex(/^[a-z_]{2,40}$/), expected_version: z.number().int().min(0) }).strict().parse(req.body);
    if (!templateById(b.template)) return reply.code(400).send({ error: 'unknown_template' });
    return withTenant(pool, (req as any).principal, async (c) => {
      if (!(await exists(c, id))) return reply.code(404).send({ error: 'not_found' });
      const cur = await loadConfig(c, id);
      if (cur.version !== b.expected_version) return reply.code(409).send({ error: 'version_conflict', current: cur.version });
      const t = fromTemplate(b.template);
      const { rows } = await c.query(`SELECT DISTINCT k FROM indicator, jsonb_object_keys(attributes) k WHERE project_id = $1`, [id]);
      const lost = rows.map((r) => r.k as string).filter((k) => !t.custom_fields.some((f) => f.key === k));
      if (lost.length) return reply.code(409).send({ error: 'field_in_use', keys: lost });
      await c.query(`INSERT INTO project_config (tenant_id, project_id, template, modules, terminology, dashboard, custom_fields, version, updated_by)
        VALUES (app.current_tenant(), $1, $2, $3, $4, $5, $6, 1, app.current_user_id())
        ON CONFLICT (tenant_id, project_id) DO UPDATE SET template = EXCLUDED.template, modules = EXCLUDED.modules, terminology = EXCLUDED.terminology,
          dashboard = EXCLUDED.dashboard, custom_fields = EXCLUDED.custom_fields, version = project_config.version + 1, updated_at = now(), updated_by = EXCLUDED.updated_by`,
        [id, t.template, t.modules, t.terminology, t.dashboard, JSON.stringify(t.custom_fields)]);
      return loadConfig(c, id);
    });
  });
}
