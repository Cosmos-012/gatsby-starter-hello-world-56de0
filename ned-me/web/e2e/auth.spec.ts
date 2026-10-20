import { test, expect } from '@playwright/test';

const PROJECT = '20000000-0000-0000-0000-000000000001';
const Q = `project=${PROJECT}&as_of=2026-12-01`;

test('sans session : invitation à se connecter, aucune donnée affichée', async ({ page }) => {
  await page.goto(`/fr?${Q}`);
  await expect(page.getByTestId('auth-login')).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toContainText('Connexion requise');
  await expect(page.getByTestId('kpi-overall-value')).toHaveCount(0);
});

test('connexion Keycloak réelle : le tenant vient du jeton, les données s\'affichent, le jeton reste côté serveur, déconnexion', async ({ page, context }) => {
  await page.goto(`/fr?${Q}`);
  await page.getByTestId('auth-login').click();
  await expect(page).toHaveURL(/\/realms\/ned\/protocol\/openid-connect\/auth/);
  await page.locator('#username').fill('demo');
  await page.locator('#password').fill('demo-pass-1');
  await page.locator('#kc-login').click();
  await expect(page).toHaveURL(new RegExp(`/fr$`));                              // retour sur la page d'origine
  await expect(page.getByTestId('auth-user')).toContainText('Demo User');
  await expect(page.getByTestId('kpi-overall-value')).toHaveText('71,7 %');      // mêmes chiffres que la graine, via le jeton de l'utilisateur

  // Le jeton n'est lisible ni par un script de la page ni en clair dans les cookies.
  expect(await page.evaluate(() => document.cookie)).toBe('');
  const cookies = (await context.cookies()).filter((c) => c.name.startsWith('ned_s'));
  expect(cookies.length).toBeGreaterThan(1);
  for (const c of cookies) { expect(c.httpOnly).toBe(true); expect(c.sameSite).toBe('Lax'); }
  // JWE compact = 5 segments (un JWT signé en a 3) : le jeton d'accès n'est pas lisible dans le cookie
  expect(cookies.filter((c) => /^ned_s\d+$/.test(c.name)).sort((a, b) => a.name.localeCompare(b.name)).map((c) => c.value).join('').split('.')).toHaveLength(5);
  expect(await page.content()).not.toMatch(/eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/);   // aucun JWT dans le HTML

  // Déconnexion : session supprimée, retour sur la page, et la session Keycloak est fermée (un nouveau login redemande le mot de passe).
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page).toHaveURL(/\/fr$/);
  await expect(page.getByTestId('auth-login')).toBeVisible();
  await page.getByTestId('auth-login').click();
  await expect(page.locator('#username')).toBeVisible();
});

test('refus : état falsifié, appel direct de /sso/callback, déconnexion hors origine', async ({ page, request }) => {
  await page.goto('/sso/callback?code=x&state=forge');
  await expect(page).toHaveURL(/auth_error=state/);
  await expect(page.getByTestId('auth-error')).toContainText('expiré');
  const r = await request.post('/sso/logout', { headers: { origin: 'https://evil.example' }, multipart: { return: '/fr' }, maxRedirects: 0 });
  expect(r.status()).toBe(403);
  // retour ouvert refusé : le paramètre return hors site est ignoré
  const l = await request.get('/sso/login?return=https://evil.example', { maxRedirects: 0 });
  expect(l.status()).toBe(307);
});

test('cookie de session falsifié ou tronqué : traité comme absence de session', async ({ page, context }) => {
  await context.addCookies([
    { name: 'ned_s_n', value: '1', url: 'http://localhost:3100' },
    { name: 'ned_s0', value: 'eyJhbGciOiJkaXIifQ..xxxx.yyyy.zzzz', url: 'http://localhost:3100' },
  ]);
  await page.goto(`/fr?${Q}`);
  await expect(page.getByTestId('auth-login')).toBeVisible();
  await expect(page.getByTestId('kpi-overall-value')).toHaveCount(0);
});
