import { z } from 'zod';
import type { Connector } from './index.ts';
import { MAX_ROWS, type RawRow } from '../imports.ts';

/**
 * KoboToolbox / ODK (API v2 : GET /api/v2/assets/<uid>/data/?format=json, en-tête « Authorization: Token … »).
 * Les soumissions d'un formulaire sont lues et transformées en lignes d'import selon une CORRESPONDANCE que l'utilisateur déclare
 * (quel champ du formulaire porte le code d'indicateur, la période, la valeur…). Rien n'est deviné : un champ absent ou illisible
 * donne une cellule vide, que le jugement refuse avec un message précis.
 *
 * Sécurité : le serveur appelé vient de la configuration saisie par un utilisateur, donc il est soumis à une LISTE D'HÔTES AUTORISÉS
 * (NED_CONNECTOR_ALLOWED_HOSTS ; par défaut les serveurs publics de Kobo). Pas de redirection suivie, pagination limitée au même hôte,
 * HTTPS obligatoire, taille et durée bornées. Le jeton n'est ni journalisé ni conservé.
 *
 * NON TESTÉ contre un serveur Kobo réel dans cet environnement (réseau sortant restreint) : la forme des réponses suit la documentation
 * publique de l'API et est vérifiée contre un serveur simulé. À valider sur un formulaire réel avant tout usage.
 */
const FIELD = z.string().min(1).max(200);
const DIMS = /^[a-z][a-z0-9_]{0,29}$/;
export const koboConfig = z.object({
  server: z.string().url().max(200), assetUid: z.string().regex(/^[A-Za-z0-9]{10,40}$/), token: z.string().min(10).max(200),
  mapping: z.object({ indicator_code: FIELD, period: FIELD, period_end: FIELD, value: FIELD, kind: z.enum(['actual', 'target']).default('actual'), comment: FIELD.optional() }).strict(),
  /** « region=groupe/region ; sexe=sex » : ventilations (nom de dimension = champ du formulaire). */
  dims: z.string().max(500).optional().transform((s, ctx) => {
    const out: Record<string, string> = {};
    for (const part of (s ?? '').split(/[;\n]/).map((x) => x.trim()).filter(Boolean)) {
      const [k, ...v] = part.split('='); const key = k.trim(), field = v.join('=').trim();
      if (!DIMS.test(key) || !field || Object.keys(out).length >= 8) { ctx.addIssue({ code: 'custom', message: `ventilation invalide : « ${part} »` }); return z.NEVER; }
      out[key] = field;
    }
    return out;
  }),
  since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict();
export type KoboConfig = z.infer<typeof koboConfig>;

export interface KoboOptions { allowedHosts: string[]; /** Seulement pour les tests locaux : autorise http sur ces hôtes. */ insecureHosts?: string[]; maxBytes?: number }
export const defaultKoboHosts = () => (process.env.NED_CONNECTOR_ALLOWED_HOSTS ?? 'kf.kobotoolbox.org,eu.kobotoolbox.org').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);

const cell = (v: unknown): string => (v == null ? '' : typeof v === 'object' ? '' : String(v).trim());
const isoDay = (v: string) => (/^\d{4}-\d{2}-\d{2}T/.test(v) ? v.slice(0, 10) : v);

export function makeKoboConnector(opts: KoboOptions = { allowedHosts: defaultKoboHosts() }): Connector<KoboConfig> {
  const allowed = new Set(opts.allowedHosts.map((h) => h.toLowerCase())), insecure = new Set((opts.insecureHosts ?? []).map((h) => h.toLowerCase()));
  const check = (u: URL) => {
    const host = u.host.toLowerCase();
    if (!allowed.has(host)) throw new Error(`serveur non autorisé : ${host} (ajoutez-le à NED_CONNECTOR_ALLOWED_HOSTS pour un Kobo auto-hébergé)`);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && insecure.has(host))) throw new Error('HTTPS obligatoire');
    if (u.username || u.password) throw new Error('identifiants dans l\'URL refusés');
  };
  return {
    id: 'kobo',
    label: { fr: 'KoboToolbox / ODK', en: 'KoboToolbox / ODK', ar: 'كوبو / ODK' },
    description: { fr: 'Importe en brouillon les soumissions d\'un formulaire de collecte.', en: 'Imports a collection form\'s submissions as drafts.', ar: 'يستورد تسليمات نموذج جمع البيانات كمسودات.' },
    form: [
      { name: 'server', type: 'url', required: true, label: { fr: 'Serveur Kobo', en: 'Kobo server', ar: 'خادم Kobo' }, placeholder: 'https://kf.kobotoolbox.org', hint: { fr: 'Doit figurer dans la liste des hôtes autorisés.', en: 'Must be in the allowed hosts list.', ar: 'يجب أن يكون ضمن قائمة الخوادم المسموحة.' } },
      { name: 'assetUid', type: 'text', required: true, label: { fr: 'Identifiant du formulaire (asset UID)', en: 'Form identifier (asset UID)', ar: 'معرّف النموذج (asset UID)' } },
      { name: 'token', type: 'password', required: true, label: { fr: 'Jeton d\'API', en: 'API token', ar: 'رمز الواجهة البرمجية' }, hint: { fr: 'Utilisé pour cette exécution seulement ; jamais conservé.', en: 'Used for this run only; never stored.', ar: 'يُستخدم لهذا التشغيل فقط ولا يُحفظ.' } },
      { name: 'mapping.indicator_code', type: 'text', required: true, label: { fr: 'Champ : code de l\'indicateur', en: 'Field: indicator code', ar: 'الحقل: رمز المؤشر' } },
      { name: 'mapping.period', type: 'text', required: true, label: { fr: 'Champ : période (ex. 2026-T1)', en: 'Field: period (e.g. 2026-Q1)', ar: 'الحقل: الفترة (مثل 2026-Q1)' } },
      { name: 'mapping.period_end', type: 'text', required: true, label: { fr: 'Champ : fin de période (date)', en: 'Field: period end (date)', ar: 'الحقل: نهاية الفترة (تاريخ)' } },
      { name: 'mapping.value', type: 'text', required: true, label: { fr: 'Champ : valeur', en: 'Field: value', ar: 'الحقل: القيمة' } },
      { name: 'mapping.kind', type: 'select', required: true, label: { fr: 'Nature des valeurs', en: 'Kind of values', ar: 'نوع القيم' },
        options: [{ value: 'actual', label: { fr: 'Réalisé', en: 'Actual', ar: 'مُنجز' } }, { value: 'target', label: { fr: 'Cible', en: 'Target', ar: 'مستهدف' } }] },
      { name: 'dims', type: 'textarea', label: { fr: 'Ventilations (facultatif)', en: 'Breakdowns (optional)', ar: 'التفصيلات (اختياري)' }, placeholder: 'region=groupe/region ; sexe=sex' },
      { name: 'since', type: 'date', label: { fr: 'Depuis le (facultatif)', en: 'Since (optional)', ar: 'منذ (اختياري)' } },
    ],
    config: koboConfig,
    async pull(cfg, { signal }) {
      const base = new URL(cfg.server); check(base);
      let url: URL | null = new URL(`/api/v2/assets/${cfg.assetUid}/data/?format=json&limit=500`, base);
      const rows: RawRow[] = [];
      const maxBytes = opts.maxBytes ?? 10_000_000;
      let pages = 0;
      while (url) {
        if (++pages > 50) throw new Error('trop de pages');
        if (url.host !== base.host) throw new Error('pagination vers un autre hôte refusée');
        check(url);
        const r = await fetch(url, { headers: { authorization: `Token ${cfg.token}`, accept: 'application/json' }, redirect: 'error', signal });
        if (r.status === 401 || r.status === 403) throw new Error('Kobo a refusé le jeton (droits insuffisants)');
        if (r.status === 404) throw new Error('formulaire introuvable sur ce serveur');
        if (!r.ok) throw new Error(`Kobo a répondu ${r.status}`);
        const text = await r.text();
        if (text.length > maxBytes) throw new Error('réponse trop volumineuse');
        let body: { results?: unknown; next?: string | null };
        try { body = JSON.parse(text); } catch { throw new Error('réponse Kobo illisible (JSON attendu)'); }
        if (!Array.isArray(body.results)) throw new Error('réponse Kobo inattendue (« results » absent)');
        for (const sub of body.results as Record<string, unknown>[]) {
          if (cfg.since && typeof sub._submission_time === 'string' && sub._submission_time.slice(0, 10) < cfg.since) continue;
          const m = cfg.mapping;
          const cells: Record<string, string> = {
            indicator_code: cell(sub[m.indicator_code]), period: cell(sub[m.period]), period_end: isoDay(cell(sub[m.period_end])),
            kind: m.kind, value: cell(sub[m.value]),
            comment: [`kobo:${cell(sub._id)}`, m.comment ? cell(sub[m.comment]) : ''].filter(Boolean).join(' '),
          };
          for (const [name, field] of Object.entries(cfg.dims)) cells[`dim_${name}`] = cell(sub[field]);
          rows.push({ line: rows.length + 1, cells });
          if (rows.length > MAX_ROWS) throw new Error(`trop de soumissions (plus de ${MAX_ROWS})`);
        }
        url = typeof body.next === 'string' && body.next ? new URL(body.next) : null;
      }
      return rows;
    },
  };
}
