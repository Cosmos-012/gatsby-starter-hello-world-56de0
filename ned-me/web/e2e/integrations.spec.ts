import { test, expect } from '@playwright/test';

const PROJECT = '20000000-0000-0000-0000-000000000001';

test('le formulaire du connecteur est généré depuis l\'API, le serveur non autorisé est refusé et le jeton n\'est jamais renvoyé', async ({ page }) => {
  await page.goto('/fr');
  await page.getByTestId('main-nav').getByRole('link', { name: 'Intégrations' }).click();
  await expect(page).toHaveURL(/\/fr\/integrations/);
  await page.locator('select[name=project]').selectOption(PROJECT);
  await page.getByRole('button', { name: 'Afficher' }).click();
  await expect(page).toHaveURL(/project=/);
  const card = page.getByTestId('connector-kobo');
  await expect(card).toContainText('KoboToolbox');
  await expect(card.getByTestId('field-token')).toHaveAttribute('type', 'password');
  await card.getByTestId('field-server').fill('https://evil.example.org');
  await card.getByTestId('field-assetUid').fill('aBcDeFgHiJkLmNoPqRsTuV');
  await card.getByTestId('field-token').fill('SECRET-TOKEN-DO-NOT-ECHO');
  await card.getByTestId('field-mapping.indicator_code').fill('code');
  await card.getByTestId('field-mapping.period').fill('periode');
  await card.getByTestId('field-mapping.period_end').fill('fin');
  await card.getByTestId('field-mapping.value').fill('valeur');
  await card.getByTestId('run-connector').click();
  await expect(card.getByTestId('run-failed')).toContainText('serveur non autorisé');
  expect(await page.content()).not.toContain('SECRET-TOKEN-DO-NOT-ECHO');
});
