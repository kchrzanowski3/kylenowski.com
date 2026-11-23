// Join → make picks → sign in on another phone → kickoff locks picks → picks are revealed.
// (docs/thanksgiving-spec.md, Testing §6. Live scoring and the leaderboard come in PR 2.)
import { expect, test, type Page } from '@playwright/test';
import { getApps, initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';

const PROJECT = 'demo-kylenowski';
const app = getApps()[0] ?? initializeApp({ projectId: PROJECT });
const db = getFirestore(app);

const team = (id: string, abbr: string, name: string, shortName: string) => ({ id, abbr, name, shortName, color: null });
const avg = (points: number, punts: number) => ({ games: 10, points, fgs: 1.8, punts, tds: 2.6, turnovers: 1.2, sacks: 2.4, longestTd: 31.5 });

async function seed(firstKickoffInMs: number) {
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const now = Date.now();
  await db.doc('tgGames/g1').set({
    espnId: 'g1',
    order: 1,
    away: team('3', 'CHI', 'Chicago Bears', 'Bears'),
    home: team('8', 'DET', 'Detroit Lions', 'Lions'),
    tv: 'CBS',
    kickoff: Timestamp.fromMillis(now + firstKickoffInMs),
    line: { favorite: 'away', spread: 2.5, overUnder: 55.5, details: 'CHI -2.5' },
    projection: { away: 29, home: 26.5 },
    scorers: [
      { id: '101', name: 'Caleb Williams', pos: 'QB', side: 'away' },
      { id: '201', name: 'Jahmyr Gibbs', pos: 'RB', side: 'home' },
    ],
    averages: { away: avg(24.1, 4.2), home: avg(28.3, 3.6), nfl: avg(22.4, 4.0) },
  });
  await db.doc('tgGames/g2').set({
    espnId: 'g2',
    order: 2,
    away: team('21', 'PHI', 'Philadelphia Eagles', 'Eagles'),
    home: team('6', 'DAL', 'Dallas Cowboys', 'Cowboys'),
    tv: 'FOX',
    kickoff: Timestamp.fromMillis(now + 3 * 3_600_000),
    line: null,
    projection: null,
    scorers: [],
    averages: { away: null, home: null, nfl: null },
  });
}

/** Collects Content-Security-Policy violations, which would mean a host is missing from the CSP. */
function watchCsp(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  return violations;
}

async function join(page: Page, name: string, pin = '') {
  await page.goto('/thanksgiving');
  const heading = page.getByRole('heading', { name: /Who are you\?|Join the game/ });
  await expect(heading).toBeVisible();
  if ((await heading.textContent()) === 'Who are you?') await page.getByRole('button', { name: 'Join with your name' }).click();
  await page.getByLabel('Your name').fill(name);
  if (pin) await page.getByLabel(/4-digit PIN/).fill(pin);
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(page.getByTestId('tg-me')).toHaveText(name);
}

test('join, pick, sign in on another phone, lock at kickoff, reveal', async ({ browser }) => {
  const LOCK_IN = 45_000;
  await seed(LOCK_IN);
  const lockAt = Date.now() + LOCK_IN;

  // Alice joins with a PIN and makes some picks for game 1.
  const alice = await (await browser.newContext()).newPage();
  const csp = watchCsp(alice);
  await join(alice, 'Alice', '1234');
  await expect(alice.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expect(alice.locator('.tg-vegas')).toContainText('projects CHI 29 – DET 26.5');
  await expect(alice.getByText('CHI 4.2 · DET 3.6 punts per game')).toBeVisible();
  await alice.getByLabel('CHI final score').fill('20');
  await alice.getByLabel('DET final score').fill('20');
  await expect(alice.getByTestId('tg-save-status')).toContainText("Saved, except the final score: it can’t be a tie");
  await alice.getByLabel('DET final score').fill('27');
  await alice.getByRole('group', { name: /Which team scores first/ }).getByRole('button', { name: 'DET' }).click();
  await alice.getByLabel('First TD scorer').selectOption({ label: 'Jahmyr Gibbs (RB)' });
  await alice.getByLabel('Total punts').fill('8');
  await expect(alice.getByTestId('tg-save-status')).toContainText('Saved ✓');
  await expect(alice.getByTestId('tg-save-status')).toContainText('4 of 15 answered');

  // Bob joins without a PIN.
  const bob = await (await browser.newContext()).newPage();
  await join(bob, 'Bob');
  await bob.getByLabel('Total punts').fill('5');
  await expect(bob.getByTestId('tg-save-status')).toContainText('Saved ✓');

  // Someone can't take "alice" (names are unique ignoring case).
  const carol = await (await browser.newContext()).newPage();
  await carol.goto('/thanksgiving');
  await carol.getByRole('button', { name: 'Join with your name' }).click();
  await carol.getByLabel('Your name').fill('alice');
  await carol.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(carol.getByRole('alert')).toContainText('is taken');

  // Alice on a second phone: her name needs the PIN, and her saved picks are there.
  const alice2 = await (await browser.newContext()).newPage();
  await alice2.goto('/thanksgiving');
  await alice2.getByRole('button', { name: /^Alice/ }).click();
  await alice2.getByLabel('PIN for Alice').fill('9999');
  await alice2.getByRole('button', { name: 'Sign in' }).click();
  await expect(alice2.getByRole('alert')).toContainText('Wrong PIN');
  await alice2.getByLabel('PIN for Alice').fill('1234');
  await alice2.getByRole('button', { name: 'Sign in' }).click();
  await expect(alice2.getByTestId('tg-me')).toHaveText('Alice');
  await expect(alice2.getByLabel('Total punts')).toHaveValue('8');

  // Before kickoff, Bob's view shows no one else's picks.
  await expect(bob.getByTestId('tg-reveal')).toHaveCount(0);

  // Kickoff: picks lock and everyone's are revealed, without a refresh.
  await alice.waitForTimeout(Math.max(0, lockAt - Date.now()));
  for (const page of [alice, bob, carol]) {
    await expect(page.getByTestId('tg-lock-status')).toHaveText('Picks are locked and revealed.', { timeout: 15_000 });
    const table = page.getByTestId('tg-reveal');
    await expect(table).toBeVisible({ timeout: 15_000 });
    await expect(table).toContainText('Alice');
    await expect(table).toContainText('Bob', { timeout: 10_000 });
    await expect(table).toContainText('CHI 20 – DET 27');
    await expect(table).toContainText('Jahmyr Gibbs');
  }
  await expect(bob.getByLabel('Total punts')).toHaveCount(0); // the form is gone
  // The wide reveal table scrolls inside its own box; the page never scrolls sideways on a phone.
  expect(await alice.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // Game 2 is still open for late arrivals.
  await bob.getByRole('button', { name: /PHI @ DAL/ }).click();
  await expect(bob.getByTestId('tg-lock-status')).toContainText('Picks lock at kickoff');
  await expect(bob.getByLabel('Total punts')).toBeVisible();

  expect(csp).toEqual([]);
});
