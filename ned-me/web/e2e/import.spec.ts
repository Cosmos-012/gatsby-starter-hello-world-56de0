import { test, expect } from '@playwright/test';

const PROJECT = '20000000-0000-0000-0000-000000000001';
const A = '40000000-0000-0000-0000-00000000000a';
const HEAD = 'indicator_code,period,period_end,kind,value,comment,dim_region';
const file = (rows: string[]) => ({ name: 'valeurs.csv', mimeType: 'text/csv', buffer: Buffer.from([HEAD, ...rows].join('\n'), 'utf8') });

test('contrôle sans écriture : lignes valides et en erreur, message précis, pas de bouton d\'import tant qu\'une erreur subsiste', async ({ page }) => {
  await page.goto('/fr');
  await page.getByTestId('main-nav').getByRole('link', { name: 'Import' }).click();
  await expect(page).toHaveURL(/\/fr\/import/);                                                         // attendre la navigation avant d'agir (sinon course avec le rendu)
  await page.locator('select[name=project]').selectOption(PROJECT);
  await page.getByRole('button', { name: 'Afficher' }).click();
  await expect(page).toHaveURL(/project=/);
  await page.locator('input[type=file]').setInputFiles(file(['A,2026-Q3,2026-09-30,actual,"97,5",depuis le fichier,Nord', 'ZZ,2026-Q3,2026-09-30,actual,1,,', 'A,2026-Q3,2026-02-30,actual,abc,,']));
  await page.getByRole('button', { name: 'Contrôler le fichier' }).click();
  await expect(page.getByTestId('imp-summary')).toContainText('3 lignes lues : 1 valides, 2 en erreur');
  await expect(page.getByTestId('imp-line-2')).toContainText('Valide');
  await expect(page.getByTestId('imp-line-3')).toContainText('indicateur inconnu');
  await expect(page.getByTestId('imp-line-4')).toContainText('date réelle');
  await expect(page.getByTestId('imp-line-4')).toContainText('nombre attendu');
  await expect(page.getByTestId('form-commit')).toHaveCount(0);                                         // « tout ou rien » : rien à importer tant qu'il y a une erreur
  // rien n'a été écrit
  await page.goto(`/fr/indicators/${A}`);
  await expect(page.getByTestId('value-2026-Q3-actual')).toHaveCount(0);
});

test('fichier corrigé : import en brouillon, visible sur la fiche, rejeu refusé', async ({ page }) => {
  await page.goto(`/fr/import?project=${PROJECT}`);
  const good = file(['A,2026-Q3,2026-09-30,actual,"97,5",depuis le fichier,Nord']);
  await page.locator('input[type=file]').setInputFiles(good);
  await page.getByRole('button', { name: 'Contrôler le fichier' }).click();
  await expect(page.getByTestId('imp-summary')).toContainText('1 lignes lues : 1 valides, 0 en erreur');
  await page.getByTestId('form-commit').getByRole('button').click();
  await expect(page.getByTestId('imp-done')).toContainText('1 valeurs importées en brouillon');
  await page.goto(`/fr/indicators/${A}`);
  await expect(page.getByTestId('state-2026-Q3-actual')).toHaveText('Brouillon');
  await expect(page.getByTestId('value-2026-Q3-actual')).toContainText('97,5');
  await expect(page.getByTestId('value-2026-Q3-actual')).toContainText('region: Nord');                 // ventilation conservée
  // rejouer le même fichier : détecté dès le contrôle, aucun écrasement
  await page.goto(`/fr/import?project=${PROJECT}`);
  await page.locator('input[type=file]').setInputFiles(good);
  await page.getByRole('button', { name: 'Contrôler le fichier' }).click();
  await expect(page.getByTestId('imp-line-2')).toContainText('existe déjà');
  await expect(page.getByTestId('form-commit')).toHaveCount(0);
});

test('fichier invalide : message clair, jamais d\'erreur technique ; arabe en RTL', async ({ page }) => {
  await page.goto(`/fr/import?project=${PROJECT}`);
  await page.locator('input[type=file]').setInputFiles({ name: 'x.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b\n1,2') });
  await page.getByRole('button', { name: 'Contrôler le fichier' }).click();
  await expect(page.getByTestId('imp-error')).toContainText('Fichier illisible');
  await expect(page.getByTestId('imp-error')).toContainText('colonnes manquantes');
  await page.goto(`/ar/import?project=${PROJECT}`);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('استيراد قيم المؤشرات');
  expect(await page.locator('main').innerText()).not.toMatch(/Import de valeurs|Contrôler/);
  await page.screenshot({ path: 'e2e/screenshots/import-ar.png', fullPage: true });
  await page.goto(`/fr/import?project=${PROJECT}`);
  await page.locator('input[type=file]').setInputFiles(file(['A,2026-Q4,2026-12-31,actual,10,,', 'B,2026-Q4,2026-12-31,actual,x,,']));
  await page.getByRole('button', { name: 'Contrôler le fichier' }).click();
  await page.screenshot({ path: 'e2e/screenshots/import-fr.png', fullPage: true });
});
