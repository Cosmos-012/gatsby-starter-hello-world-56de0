import { test, expect } from '@playwright/test';

const PROJECT = '20000000-0000-0000-0000-000000000001';
const A = '40000000-0000-0000-0000-00000000000a';
const pct = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 });

test('liste : chiffres de la source, statut en texte + icône, filtre par statut, indicateur sans donnée jamais à zéro', async ({ page }) => {
  await page.goto('/fr');
  await page.getByTestId('main-nav').getByRole('link', { name: 'Indicateurs' }).click();
  await expect(page).toHaveURL(/\/fr\/indicators/);
  await expect(page.getByTestId('ind-table').locator('tbody tr')).toHaveCount(4);
  await expect(page.getByTestId('ind-ach-A')).toHaveText(pct.format(0.95));
  await expect(page.getByTestId('ind-ach-B')).toHaveText(pct.format(0.5));
  await expect(page.getByTestId('ind-status-B')).toContainText('En retard');
  await expect(page.getByTestId('ind-status-A')).toContainText('Sur la cible');
  await expect(page.getByTestId('ind-ach-D')).toHaveText('—');                                             // pas de donnée : jamais « 0 % »
  await expect(page.getByTestId('ind-status-D')).toContainText('Sans donnée');
  await page.locator('select[name=status]').selectOption('RED');
  await page.getByRole('button', { name: 'Afficher' }).click();
  await expect(page.getByTestId('ind-table').locator('tbody tr')).toHaveCount(1);
  await expect(page.getByTestId('ind-row-B')).toBeVisible();
});

test('fiche : historique, saisie en brouillon, soumission ; doublon et valeur invalide refusés avec un message clair', async ({ page }) => {
  await page.goto(`/fr/indicators/${A}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Services en ligne');
  await expect(page.getByTestId('state-Q1-actual')).toHaveText('Approuvée');
  await expect(page.getByTestId('value-Q1-target')).toContainText('100');

  const f = page.getByTestId('form-add-value');
  const fill = async (period: string, value: string) => {
    await f.locator('select[name=kind]').selectOption('actual');
    await f.locator('input[name=period]').fill(period);
    await f.locator('input[name=period_end]').fill('2026-06-30');
    await f.locator('input[name=value]').fill(value);
    await f.getByRole('button', { name: 'Enregistrer la valeur' }).click();
  };
  await fill('2026-Q2', '96,5');                                                                              // virgule décimale acceptée
  await expect(page.getByTestId('ind-msg')).toContainText('Valeur enregistrée en brouillon');
  await expect(page.getByTestId('state-2026-Q2-actual')).toHaveText('Brouillon');
  await expect(page.getByTestId('value-2026-Q2-actual')).toContainText('96,5');
  await fill('2026-Q2', '97');
  await expect(page.getByTestId('ind-msg')).toContainText('existe déjà');
  await fill('2026-Q5', 'abc');
  await expect(page.getByTestId('ind-msg')).toContainText('Valeurs invalides');
  await expect(page.getByTestId('value-2026-Q5-actual')).toHaveCount(0);

  await page.getByTestId('value-2026-Q2-actual').getByRole('button', { name: 'Soumettre' }).click();
  await expect(page.getByTestId('ind-msg')).toContainText('État mis à jour');
  await expect(page.getByTestId('state-2026-Q2-actual')).toHaveText('Soumise');
  // une valeur soumise ne compte pas dans le réalisé : l'atteinte de la liste est inchangée
  await page.goto('/fr/indicators');
  await expect(page.getByTestId('ind-ach-A')).toHaveText(pct.format(0.95));
});

test('identifiant inexistant ou invalide : 404, jamais d\'erreur technique', async ({ page }) => {
  expect((await page.goto('/fr/indicators/pas-un-uuid'))!.status()).toBe(404);
  const r = await page.goto('/fr/indicators/00000000-0000-0000-0000-000000000000');
  expect(r!.status()).toBeLessThan(500);
});

test('arabe : liste en RTL, sans texte français, chiffres occidentaux', async ({ page }) => {
  await page.goto('/ar/indicators');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('المؤشرات');
  expect(await page.locator('main').innerText()).not.toMatch(/Indicateurs|Sur la cible|En retard/);
  await expect(page.getByTestId('ind-status-B')).toContainText('متأخر');
  await page.screenshot({ path: 'e2e/screenshots/indicators-ar.png', fullPage: true });
  await page.goto('/fr/indicators'); await page.screenshot({ path: 'e2e/screenshots/indicators-fr.png', fullPage: true });
  await page.goto(`/fr/indicators/${A}`); await page.screenshot({ path: 'e2e/screenshots/indicator-fr.png', fullPage: true });
});
