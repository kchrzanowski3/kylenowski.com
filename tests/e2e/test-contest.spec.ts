// /thanksgiving-test (docs/thanksgiving-spec.md, "Test contest"): the same app on the test
// contest's tgTest* collections, with a TEST banner. A seed player signs in (through the sign-in
// service with ?contest=test) and saves a pick, and nothing lands in the real tg* collections.
import { expect, test, type Page } from '@playwright/test';
import { getApps, initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';

const PROJECT = 'demo-kylenowski';
const app = getApps()[0] ?? initializeApp({ projectId: PROJECT });
const db = getFirestore(app);

const team = (id: string, abbr: string, name: string, shortName: string) => ({ id, abbr, name, shortName, color: null });

async function seed() {
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const now = Date.now();
  const game = (id: string, order: number, away: ReturnType<typeof team>, home: ReturnType<typeof team>, kickoff: number) => ({
    espnId: id, order, away, home, tv: 'ESPN', kickoff: Timestamp.fromMillis(kickoff), line: null, projection: null,
    scorers: [], averages: { away: null, home: null, nfl: null },
  });
  // Monday's game has kicked off; Wednesday's is still open.
  await db.doc('tgTestGames/mon').set(game('mon', 1, team('4', 'CIN', 'Cincinnati Bengals', 'Bengals'), team('28', 'WSH', 'Washington Commanders', 'Commanders'), now - 3_600_000));
  await db.doc('tgTestGames/wed').set(game('wed', 2, team('9', 'GB', 'Green Bay Packers', 'Packers'), team('14', 'LAR', 'Los Angeles Rams', 'Rams'), now + 3 * 3_600_000));
  for (const n of [1, 2]) {
    await db.doc(`tgTestPlayers/seed${n}`).set({ name: `Test${n}`, hasPin: false, joinedAt: Timestamp.now() });
    await db.doc(`tgTestSecrets/seed${n}`).set({ pinHash: null, salt: null, failures: 0, lockedUntil: null });
    await db.doc(`tgTestNames/test${n}`).set({ playerId: `seed${n}` });
  }
}

function watchCsp(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  return violations;
}

test('/thanksgiving-test loads the test games with a TEST banner, and a test player can sign in and pick', async ({ page }) => {
  await seed();
  const csp = watchCsp(page);
  expect((await page.goto('/thanksgiving-test'))?.status()).toBe(200);
  await expect(page.getByTestId('tg-test-banner')).toContainText('TEST');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);

  const tabs = page.getByRole('navigation', { name: 'Games' }).getByRole('button');
  await expect(tabs).toHaveText([/CIN @ WSH\s*Locked/, /GB @ LAR\s*Open/]);

  // Test1 has no PIN: picking the name signs in.
  await page.getByRole('button', { name: 'Test1', exact: true }).click();
  await expect(page.getByTestId('tg-me')).toHaveText('Test1');
  await page.getByLabel('Total punts').fill('7');
  await expect(page.getByTestId('tg-save-status')).toContainText('Saved ✓');

  expect((await db.doc('tgTestGames/wed/picks/seed1').get()).get('answers')).toMatchObject({ punts: 7 });
  for (const c of ['tgGames', 'tgPlayers', 'tgNames']) expect((await db.collection(c).get()).size, c).toBe(0);

  // The test sign-in is kept apart from the real game's: /thanksgiving is still signed out, and
  // the test page still knows you.
  await page.goto('/thanksgiving');
  await expect(page.getByRole('heading', { name: /Who are you\?|Join the game/ })).toBeVisible();
  await expect(page.getByTestId('tg-me')).toHaveCount(0);
  await page.goto('/thanksgiving-test');
  await expect(page.getByTestId('tg-me')).toHaveText('Test1');
  expect(csp).toEqual([]);
});

test('/thanksgiving-test/admin loads with the TEST banner and the admin sign-in', async ({ page }) => {
  expect((await page.goto('/thanksgiving-test/admin'))?.status()).toBe(200);
  await expect(page.getByTestId('tg-test-banner')).toContainText('TEST');
  await expect(page.getByRole('heading', { name: 'Admin sign-in' })).toBeVisible();
});
