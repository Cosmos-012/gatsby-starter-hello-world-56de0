import fr from '../../messages/fr.json' with { type: 'json' };
import ar from '../../messages/ar.json' with { type: 'json' };
import en from '../../messages/en.json' with { type: 'json' };

export const LOCALES = ['fr', 'ar', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export type Messages = Record<string, string>;
const CATALOGS: Record<Locale, Messages> = { fr, ar, en };

export const isLocale = (s: string): s is Locale => (LOCALES as readonly string[]).includes(s);
export const dirOf = (l: Locale) => (l === 'ar' ? 'rtl' : 'ltr');
export const messagesFor = (l: Locale): Messages => CATALOGS[l];

/** Traduit une clé ; une clé absente s'affiche telle quelle (repérable), jamais un texte inventé. */
export function translate(m: Messages, key: string, params: Record<string, string | number> = {}): string {
  const s = m[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in params ? String(params[k]) : `{${k}}`));
}

/** Balise de formatage. Arabe : chiffres occidentaux par défaut (NED_AR_NUMERALS=arab pour ٠١٢…). */
export function numberTag(l: Locale, arNumerals = process.env.NED_AR_NUMERALS): string {
  if (l === 'ar') return arNumerals === 'arab' ? 'ar-u-nu-arab' : 'ar-u-nu-latn';   // explicite : selon CLDR, « ar » seul est déjà en chiffres latins
  return l === 'fr' ? 'fr-FR' : 'en-GB';
}

export function formatters(l: Locale) {
  const tag = numberTag(l);
  const num = new Intl.NumberFormat(tag, { maximumFractionDigits: 1 });
  const pct = new Intl.NumberFormat(tag, { style: 'percent', maximumFractionDigits: 1 });
  const date = new Intl.DateTimeFormat(tag, { dateStyle: 'long', timeZone: 'UTC' });
  return {
    num: (v: number) => num.format(v),
    /** ratio 0..1 → pourcentage */
    ratio: (v: number) => pct.format(v),
    /** valeur déjà en pourcentage (0..100) */
    percent: (v: number) => pct.format(v / 100),
    date: (iso: string) => date.format(new Date(`${iso}T00:00:00Z`)),
  };
}

/** Pluriel selon les règles CLDR de la langue (arabe : zero/one/two/few/many/other) : clé.<catégorie>, puis clé.other, puis la clé seule. */
export function translatePlural(m: Messages, locale: Locale, key: string, n: number, params: Record<string, string | number> = {}): string {
  const cat = new Intl.PluralRules(locale).select(n);
  const k = [`${key}.${cat}`, `${key}.other`, key].find((c) => c in m) ?? key;
  return translate(m, k, params);
}
