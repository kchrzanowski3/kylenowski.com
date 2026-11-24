// Smoke tests against the deployed site, run by CI after every production deploy
// (.github/workflows/deploy.yml, "smoke" job). They only read: nothing here joins, signs in or
// saves picks, so they never add players or picks to the real game.
//
//   SMOKE_URL=https://kylenowski.com npx playwright test -c playwright.smoke.config.ts
import { expect, test, type Page } from '@playwright/test';

const SIGN_IN_API = process.env.SMOKE_API ?? 'https://us-central1-kylenowski-com.cloudfunctions.net/tg-auth';
const ADMIN_API = process.env.SMOKE_ADMIN_API ?? 'https://us-central1-kylenowski-com.cloudfunctions.net/tg-admin';

/** Console errors (CSP violations, failed Firestore connections, crashes) while a page is open. */
function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || /Content Security Policy|Refused to/i.test(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

test('home page loads', async ({ page }) => {
  const errors = watchConsole(page);
  const res = await page.goto('/');
  expect(res?.status()).toBe(200);
  await expect(page.locator('h1')).toBeVisible();
  expect(errors).toEqual([]);
});

test('/thanksgiving loads its games and sign-in, with no console errors', async ({ page }) => {
  const errors = watchConsole(page);
  const res = await page.goto('/thanksgiving');
  expect(res?.status()).toBe(200);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);

  // The React app reached Firebase and Firestore: the three Thursday games and the sign-in card.
  await expect(page.getByRole('navigation', { name: 'Games' }).getByRole('button')).toHaveCount(3, { timeout: 20_000 });
  const signedOut = page.getByRole('heading', { name: /Who are you\?|Join the game/ });
  await expect(signedOut).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the sign-in service answers, from the site\'s origin', async ({ request, baseURL }) => {
  // CORS preflight from the site.
  const preflight = await request.fetch(`${SIGN_IN_API}/login`, {
    method: 'OPTIONS',
    headers: { origin: baseURL!, 'access-control-request-method': 'POST' },
  });
  expect(preflight.status()).toBe(204);
  expect(preflight.headers()['access-control-allow-origin']).toBe(baseURL);

  // A login for a player that doesn't exist: proves routing and Firestore access, changes nothing.
  const res = await request.post(`${SIGN_IN_API}/login`, { data: { playerId: 'smokeTestNobody' } });
  expect(res.status()).toBe(404);
  expect((await res.json()).error).toMatch(/doesn.t exist/);
});

test('the admin page loads, and the admin service answers but refuses without a sign-in', async ({ page, request }) => {
  const errors = watchConsole(page);
  expect((await page.goto('/thanksgiving/admin'))?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Admin sign-in' })).toBeVisible({ timeout: 20_000 });
  expect(errors).toEqual([]);

  // GET also makes sure the admin's account exists (see functions/src/admin.ts, ensureAdminUser).
  const health = await request.get(ADMIN_API);
  expect(health.status()).toBe(200);
  const refused = await request.post(ADMIN_API, { data: { action: 'rescore' } });
  expect(refused.status()).toBe(401);
});


// The test contest (docs/thanksgiving-spec.md, "Test contest"). Read-only too: it doesn't sign in.
test('/thanksgiving-test loads with its TEST banner and the test games, with no console errors', async ({ page }) => {
  const errors = watchConsole(page);
  const res = await page.goto('/thanksgiving-test');
  expect(res?.status()).toBe(200);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expect(page.getByTestId('tg-test-banner')).toContainText('TEST');
  // The test pre-game refresh CI starts after the deploy may still be filling in the games.
  const tabs = page.getByRole('navigation', { name: 'Games' }).getByRole('button');
  await expect(tabs.first().or(page.getByText('The games will show up here shortly.'))).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the sign-in service answers for the test contest', async ({ request }) => {
  const res = await request.post(`${SIGN_IN_API}/login?contest=test`, { data: { playerId: 'smokeTestNobody' } });
  expect(res.status()).toBe(404);
  expect((await res.json()).error).toMatch(/doesn.t exist/);
  const unknown = await request.post(`${SIGN_IN_API}/login?contest=nope`, { data: { playerId: 'smokeTestNobody' } });
  expect(unknown.status()).toBe(404);
  expect((await unknown.json()).error).toBe('Unknown contest.');
});
