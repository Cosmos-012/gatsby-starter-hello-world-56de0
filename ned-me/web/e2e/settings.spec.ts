import { test, expect } from '@playwright/test';

const PROJECT = '20000000-0000-0000-0000-000000000001';
const S = `/fr/settings?project=${PROJECT}`;
const save = (p: import('@playwright/test').Page, form: string) => p.getByTestId(form).getByRole('button', { name: /Enregistrer|Appliquer le modèle|Ajouter un champ/ }).click();

test('navigation entre pages, choix du projet, configuration par défaut lisible', async ({ page }) => {
  await page.goto('/fr');
  await expect(page.getByTestId('main-nav').getByRole('link', { name: 'Configuration' })).toBeVisible();
  await page.getByTestId('main-nav').getByRole('link', { name: 'Configuration' }).click();
  await expect(page).toHaveURL(/\/fr\/settings/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Configuration du projet');
  await page.locator('select[name=project]').selectOption(PROJECT);
  await page.getByRole('button', { name: 'Afficher' }).click();
  await expect(page.getByTestId('config-version')).toContainText('Version');
  // modules de base : cochés et non modifiables ; modules non construits : signalés
  await expect(page.getByText('Toujours actif').first()).toBeVisible();
  await expect(page.getByText(/Pas encore disponible/).first()).toBeVisible();
});

test('un modèle adapte libellés, champs et tableau de bord ; les modules et éléments masqués disparaissent ; le retour au modèle générique restaure', async ({ page }) => {
  await page.goto(S);
  await page.getByTestId('form-template').locator('select').selectOption('health');
  await save(page, 'form-template');
  await expect(page.getByTestId('settings-msg')).toContainText('Configuration enregistrée');
  await expect(page.getByTestId('field-facility_level')).toBeVisible();                                   // champ suggéré par le modèle
  await expect(page.locator('input[name=lv_impact_fr]')).toHaveValue('Impact sanitaire');

  await page.goto(`/fr?project=${PROJECT}&as_of=2026-12-01`);
  await expect(page.getByTestId('level-impact')).toContainText('Impact sanitaire');                      // terminologie du modèle sur le tableau de bord
  await expect(page.getByTestId('kpi-overall-value')).toHaveText('71,7 %');                              // les chiffres ne changent pas

  await page.goto(S);
  await page.locator('#mod_risks').uncheck();
  await page.locator('#w_alerts').uncheck();
  await save(page, 'form-general');
  await expect(page.getByTestId('settings-msg')).toContainText('Configuration enregistrée');
  await page.goto(`/fr?project=${PROJECT}&as_of=2026-12-01`);
  await expect(page.getByTestId('block-risks')).toHaveCount(0);                                          // module désactivé
  await expect(page.getByTestId('alerts')).toHaveCount(0);                                               // élément masqué
  await expect(page.getByTestId('block-accountability')).toBeVisible();                                  // le reste demeure

  // L'autre langue lit la même configuration, avec son propre libellé ou le libellé standard
  await page.goto(`/en?project=${PROJECT}&as_of=2026-12-01`);
  await expect(page.getByTestId('level-impact')).toContainText('Health impact');

  await page.goto(S);
  await page.getByTestId('form-template').locator('select').selectOption('generic');
  await save(page, 'form-template');
  await expect(page.getByTestId('settings-msg')).toContainText('Configuration enregistrée');
  await page.goto(`/fr?project=${PROJECT}&as_of=2026-12-01`);
  await expect(page.getByTestId('block-risks')).toBeVisible();
  await expect(page.getByTestId('level-impact')).toContainText('Impact');
});

test('champs personnalisés : ajout (liste avec options), retrait, valeurs invalides refusées sans perte de la page', async ({ page }) => {
  await page.goto(S);
  const f = page.getByTestId('form-add-field');
  await f.locator('input[name=key]').fill('zone');
  await f.locator('select[name=type]').selectOption('select');
  await f.locator('input[name=label_fr]').fill('Zone');
  await f.locator('textarea[name=options]').fill('north|Nord|North|الشمال\nsouth|Sud|South|الجنوب');
  await save(page, 'form-add-field');
  await expect(page.getByTestId('settings-msg')).toContainText('Configuration enregistrée');
  await expect(page.getByTestId('field-zone')).toContainText('Zone');
  // liste sans option : refusée par l'API, message clair
  await f.locator('input[name=key]').fill('vide');
  await f.locator('select[name=type]').selectOption('select');
  await f.locator('input[name=label_fr]').fill('Vide');
  await f.locator('textarea[name=options]').fill('');
  await save(page, 'form-add-field');
  await expect(page.getByTestId('settings-msg')).toContainText('Valeurs invalides');
  await expect(page.getByTestId('field-vide')).toHaveCount(0);
  await page.getByTestId('field-zone').getByRole('button', { name: 'Retirer' }).click();
  await expect(page.getByTestId('field-zone')).toHaveCount(0);
});

test('arabe : page de configuration en RTL, sans texte français', async ({ page }) => {
  await page.goto(`/ar/settings?project=${PROJECT}`);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('إعدادات المشروع');
  expect(await page.locator('main').innerText()).not.toContain('Configuration');
  await page.screenshot({ path: 'e2e/screenshots/settings-ar.png', fullPage: true });
  await page.goto(S); await page.screenshot({ path: 'e2e/screenshots/settings-fr.png', fullPage: true });
});
