import { test, expect, type Page } from '@playwright/test';
import fr from '../messages/fr.json' with { type: 'json' };
import ar from '../messages/ar.json' with { type: 'json' };

const PROJECT = '20000000-0000-0000-0000-000000000001';
const Q = `project=${PROJECT}&as_of=2026-12-01`;
const api = async (path: string) => {
  const r = await fetch(`${process.env.NED_API_URL}${path}`, { headers: { authorization: `Bearer ${process.env.NED_DEV_TOKEN}` } });
  return r.json();
};
const text = (p: Page, id: string) => p.getByTestId(id).innerText();

test('français : chiffres identiques à la source API, statuts, niveaux, alertes, modules absents', async ({ page }) => {
  const o = await api(`/dashboard/overview?project_id=${PROJECT}&as_of=2026-12-01`);
  // Valeurs calculées à la main (cf. db/seed/e2e.sql) : vérifient aussi l'API elle-même
  expect(o.performance.overall).toBe(0.7167);
  expect(o.performance.by_status).toEqual({ GREEN: 1, AMBER: 1, RED: 1, GREY: 1 });

  await page.goto(`/fr?${Q}`);
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(fr['app.question']);

  const pct = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 });
  expect(await text(page, 'kpi-overall-value')).toBe(pct.format(o.performance.overall));       // 71,7 %
  expect(await text(page, 'kpi-coverage-value')).toBe(pct.format(o.performance.coverage));     // 75 %
  for (const s of ['GREEN', 'AMBER', 'RED', 'GREY'] as const) {
    await expect(page.getByTestId(`status-${s}`)).toContainText(fr[`status.${s}`]);              // libellé, pas seulement une couleur
    await expect(page.getByTestId(`status-${s}`)).toContainText(String(o.performance.by_status[s]));
  }
  await expect(page.getByTestId('level-impact')).toContainText(fr['kpi.no_data']);               // jamais « 0 % » sans donnée
  await expect(page.getByTestId('level-output')).toContainText(pct.format(0.725));

  const alerts = page.getByTestId('alert');
  await expect(alerts).toHaveCount(o.alerts.length);
  expect(o.alerts.length).toBeGreaterThan(0);
  for (const a of o.alerts) await expect(page.locator(`[data-testid="alert"][data-type="${a.type}"]`).first()).toBeVisible();
  const body = await page.locator('main').innerText();
  expect(body).not.toMatch(/\balert\.|\bstatus\.|\bkpi\.|\{\w+\}/);                              // aucune clé ni paramètre non traduit
  expect(body).toContain(`Indicateur B en retard (${pct.format(0.5)} d'atteinte)`);
  expect(body).toContain('1 plainte hors délai de résolution');                                   // accord au singulier
  expect(body).not.toMatch(/\b1 (plaintes|risques|revues)\b/);

  await expect(page.getByTestId('not-available')).toContainText(fr['na.activities']);
  await expect(page.getByTestId('not-available')).toContainText(fr['na.finance']);
  await expect(page.getByTestId('block-risks')).toContainText(fr['risk.unescalated']);
  await expect(page.locator('.src code').first()).toContainText('/indicators/tracking');        // chaque bloc cite sa source
});

test('arabe : dir=rtl, aucun texte d\'interface français, chiffres occidentaux par défaut', async ({ page }) => {
  await page.goto(`/ar?${Q}`);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar['app.question']);
  const body = await page.locator('body').innerText();
  // Tout libellé français (différent de sa traduction) présent dans la page arabe serait un texte codé en dur.
  const leaks = Object.entries(fr).filter(([k, v]) => v !== (ar as Record<string, string>)[k] && !k.startsWith('lang.') && v.length > 3)
    .map(([, v]) => v.replace(/\{\w+\}/g, '').trim()).filter((v) => v.length > 3 && body.includes(v));
  expect(leaks).toEqual([]);
  expect(await text(page, 'kpi-overall-value')).toBe(new Intl.NumberFormat('ar-u-nu-latn', { style: 'percent', maximumFractionDigits: 1 }).format(0.7167));
  await expect(page.locator('select[name=project] option:checked')).toContainText('الخدمات الرقمية الوطنية');   // nom de projet dans la langue
  await expect(page.getByTestId('alert').first()).toContainText(ar['severity.critical']);
  await expect(page.getByTestId('alerts')).toContainText('شكوى واحدة تجاوزت مهلة الحل');          // forme « واحد » et non « 1 شكاوى »
  await expect(page.getByTestId('kpi-dq-value').locator('bdi[dir=ltr]')).toHaveCount(1);         // fraction lisible gauche-droite
});

test('anglais et changement de langue conservant le projet et la date', async ({ page }) => {
  await page.goto(`/en?${Q}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('How is my project performing right now?');
  await page.getByRole('link', { name: 'العربية' }).click();
  await expect(page).toHaveURL(new RegExp(`/ar\\?project=${PROJECT}&as_of=2026-12-01$`));
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
});

test('filtre : formulaire sans JavaScript ; paramètres invalides ignorés sans erreur ; racine redirigée', async ({ page }) => {
  for (const bad of ['project=pas-un-uuid&as_of=2026-13-45', 'as_of=2026-02-30', 'as_of=%27%3BDROP']) {
    await page.goto(`/fr?${bad}`);
    await expect(page.getByTestId('kpi-overall-value')).toBeVisible();                          // paramètres ignorés, page normale
    await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0);             // (l'annonceur de navigation de Next est vide)
  }
  await page.goto('/');
  await expect(page).toHaveURL(/\/fr$/);
  await page.goto(`/fr`);
  await page.locator('select[name=project]').selectOption(PROJECT);
  await page.locator('input[name=as_of]').fill('2026-12-01');
  await page.getByRole('button', { name: fr['filter.apply'] }).click();
  await expect(page).toHaveURL(new RegExp(`project=${PROJECT}`));
  await expect(page.getByTestId('status-RED')).toContainText('1');
  expect((await page.goto('/xx'))!.status()).toBe(404);                                          // langue inconnue
});

test('captures (relecture visuelle) : FR clair, AR sombre, mobile', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.goto(`/fr?${Q}`); await page.screenshot({ path: 'e2e/screenshots/fr-light.png', fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(`/ar?${Q}`); await page.screenshot({ path: 'e2e/screenshots/ar-dark.png', fullPage: true });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`/ar?${Q}`); await page.screenshot({ path: 'e2e/screenshots/ar-mobile.png', fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);                                                                   // pas de défilement horizontal sur mobile
});
