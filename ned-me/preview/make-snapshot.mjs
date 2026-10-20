// Instantané navigable de l'interface (HTML autonome par page : styles intégrés, scripts retirés, liens réécrits vers les fichiers frères).
// Usage : node preview/make-snapshot.mjs <dossier_sortie> [http://localhost:3100]     (le serveur doit tourner : ./preview.sh start)
import { chromium } from '../web/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = process.argv[2]; const BASE = process.argv[3] ?? 'http://localhost:3100';
if (!OUT) { console.error('usage: make-snapshot.mjs <dossier> [base]'); process.exit(2); }
mkdirSync(OUT, { recursive: true });
const P = '20000000-0000-0000-0000-000000000001', A = '40000000-0000-0000-0000-00000000000a';
const pages = [];
for (const l of ['fr', 'en', 'ar']) pages.push(
  { key: `/${l}`, url: `/${l}?project=${P}&as_of=2026-12-01`, file: `overview-${l}.html` },
  { key: `/${l}/indicators`, url: `/${l}/indicators`, file: `indicators-${l}.html` },
  { key: `/${l}/indicators/${A}`, url: `/${l}/indicators/${A}`, file: `indicator-${l}.html` },
  { key: `/${l}/import`, url: `/${l}/import?project=${P}`, file: `import-${l}.html` },
  { key: `/${l}/settings`, url: `/${l}/settings?project=${P}`, file: `settings-${l}.html` });
const files = Object.fromEntries(pages.map((p) => [p.key, p.file]));
const NOTE = {
  fr: "Aperçu statique de l'application, avec des données de démonstration synthétiques. La navigation et les langues fonctionnent ; les formulaires sont désactivés.",
  en: 'Static preview of the application, with synthetic demonstration data. Navigation and languages work; forms are disabled.',
  ar: 'معاينة ثابتة للتطبيق ببيانات تجريبية اصطناعية. التنقل واللغات تعمل، أما النماذج فمعطّلة.',
};
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
for (const p of pages) {
  const page = await ctx.newPage();
  await page.goto(BASE + p.url, { waitUntil: 'networkidle' });
  const css = await page.evaluate(async () => (await Promise.all([...document.querySelectorAll('link[rel=stylesheet]')].map((l) => fetch(l.href).then((r) => r.text())))).join('\n'));
  await page.evaluate(({ files, base }) => {
    document.querySelectorAll('script, link[rel=stylesheet], link[rel=preload], link[rel=modulepreload], link[rel=prefetch], next-route-announcer').forEach((e) => e.remove());
    for (const a of document.querySelectorAll('a[href]')) {
      const h = a.getAttribute('href');
      if (h.startsWith('#')) continue;
      let f = null;
      try { const u = new URL(h, base); if (u.origin === new URL(base).origin) f = files[u.pathname.replace(/\/$/, '')]; } catch { /* lien non analysable */ }
      if (f) a.setAttribute('href', f); else { a.setAttribute('href', '#'); a.setAttribute('aria-disabled', 'true'); a.removeAttribute('download'); }
    }
    for (const f of document.querySelectorAll('form')) { f.removeAttribute('action'); f.setAttribute('onsubmit', 'return false'); }
  }, { files, base: BASE });
  const lang = p.key.split('/')[1];
  let html = await page.content();
  const banner = `<style>#ned-preview-banner{margin:0;padding:.55rem 1rem;font:13px/1.4 system-ui,sans-serif;text-align:center;background:var(--surface-1,#fcfcfb);color:var(--text-secondary,#52514e);border-bottom:1px solid var(--border,#dedcd5)}</style><div id="ned-preview-banner">${NOTE[lang]}</div>`;
  html = html.replace(/<body([^>]*)>/, `<body$1>${banner}`).replace('</head>', `<style>${css}</style></head>`);
  writeFileSync(`${OUT}/${p.file}`, html);
  await page.close();
}
await browser.close();
console.log(`${pages.length} pages écrites dans ${OUT}`);
