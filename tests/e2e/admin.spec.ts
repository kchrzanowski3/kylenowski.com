// Admin end to end (docs/thanksgiving-spec.md, Testing §6): sign in with the emailed link, re-run
// scoring, fix a stat, and watch the players' leaderboard move without a refresh.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { getApps, initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';

const PROJECT = 'demo-kylenowski';
const ADMIN = 'admin@example.com';
const app = getApps()[0] ?? initializeApp({ projectId: PROJECT });
const db = getFirestore(app);
const team = (id: string, abbr: string, name: string, shortName: string) => ({ id, abbr, name, shortName, color: null });

/** The emulator loads firestore.rules with the placeholder; give it the test admin's address. */
async function loadRulesWithAdmin() {
  const rules = readFileSync('firestore.rules', 'utf8').replaceAll('__ADMIN_EMAIL__', ADMIN);
  const res = await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}:securityRules`, {
    method: 'PUT',
    body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: rules }] } }),
  });
  expect(res.ok).toBe(true);
}

async function seed() {
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  const now = Date.now();
  const base = {
    tv: 'CBS', line: null, projection: null, scorers: [{ id: '201', name: 'Jahmyr Gibbs', pos: 'RB', side: 'home' }],
    averages: { away: null, home: null, nfl: null },
  };
  await db.doc('tgGames/g1').set({ ...base, espnId: 'g1', order: 1, away: team('3', 'CHI', 'Chicago Bears', 'Bears'), home: team('8', 'DET', 'Detroit Lions', 'Lions'), kickoff: Timestamp.fromMillis(now - 3_600_000) });
  await db.doc('tgGames/g2').set({ ...base, espnId: 'g2', order: 2, away: team('21', 'PHI', 'Philadelphia Eagles', 'Eagles'), home: team('6', 'DAL', 'Dallas Cowboys', 'Cowboys'), kickoff: Timestamp.fromMillis(now + 3_600_000) });
  await db.doc('tgPlayers/alice').set({ name: 'Alice', hasPin: false });
  await db.doc('tgPlayers/bob').set({ name: 'Bob', hasPin: false });
  await db.doc('tgGames/g1/picks/alice').set({ answers: { punts: 4 } });
  await db.doc('tgGames/g1/picks/bob').set({ answers: { punts: 7 } });
  // What the live worker would have stored from the feed: game 1 in the 3rd quarter, 4 punts.
  const feed = {
    state: 'in', period: 3, clock: '5:00', halftimeReached: true, away: 10, home: 14,
    firstScore: { side: 'home', type: 'fg' }, firstTd: null, halftime: { away: 7, home: 7 },
    passTds: { away: 1, home: 1 }, rushTds: { away: 0, home: 0 }, missedKick: false, leadChange4q: false,
    fgs: 2, punts: 4, tds: 2, turnovers: 1, longestTd: 30, sacks: 2,
  };
  await db.doc('tgLive/g1').set({ feed, feedAt: now, recent: [{ at: now - 60_000, stats: feed }], scorers: {} });
}

test('admin signs in by emailed link, fixes a stat, and the leaderboard moves', async ({ browser }) => {
  await loadRulesWithAdmin();
  await seed();

  // A family member watching the standings.
  const viewer = await (await browser.newContext()).newPage();
  await viewer.goto('/thanksgiving');
  await expect(viewer.getByRole('navigation', { name: 'Games' })).toBeVisible();

  // The admin asks for a sign-in link...
  const admin = await (await browser.newContext()).newPage();
  await admin.goto('/thanksgiving/admin');
  await admin.getByLabel('Email').fill(ADMIN);
  await admin.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(admin.getByRole('status')).toContainText('Check your email');
  // ...and opens it (the Auth emulator keeps the emailed codes).
  const codes = await (await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/oobCodes`)).json();
  const code = codes.oobCodes.find((c: { email: string; requestType: string }) => c.email === ADMIN && c.requestType === 'EMAIL_SIGNIN');
  await admin.goto(`/thanksgiving/admin?mode=signIn&oobCode=${code.oobCode}&apiKey=demo-key&lang=en`);
  await expect(admin.getByTestId('tg-admin-email')).toHaveText(ADMIN);
  await expect(admin).toHaveURL(/\/thanksgiving\/admin$/); // the one-time code is gone from the address bar

  // The admin screen shows the live feed values.
  const g1 = admin.getByTestId('tg-admin-game-g1');
  await expect(g1.getByRole('row', { name: /^Punts/ })).toContainText('4');

  // Re-run scoring: Alice's 4 punts is exact.
  await admin.getByRole('button', { name: 'Re-run scoring' }).click();
  await expect(viewer.getByTestId('tg-total-Alice')).toHaveText('3');
  await expect(viewer.getByTestId('tg-total-Bob')).toHaveText('0');

  // The feed had it wrong: there were 7 punts. Fix it; Bob takes the lead on every phone.
  await g1.getByLabel('Override Punts').fill('7');
  await g1.getByRole('row', { name: /^Punts/ }).getByRole('button', { name: 'Set' }).click();
  await expect(viewer.getByTestId('tg-total-Bob')).toHaveText('3');
  await expect(viewer.getByTestId('tg-total-Alice')).toHaveText('0');
  await expect(g1.getByRole('row', { name: /^Punts/ })).toContainText('7');

  // The viewer's game-1 scoreboard shows it too.
  await viewer.getByRole('button', { name: /CHI @ DET/ }).click();
  // The game's header carries the score between the team names, with a single live clock pill below (no duplicate Live badge).
  await expect(viewer.getByTestId('tg-livescore')).toContainText(/Bears\s*10\s*–\s*14\s*Lions/);
  await expect(viewer.getByTestId('tg-clock')).toBeVisible();
  await expect(viewer.getByTestId('tg-lock-status')).toHaveCount(0);

  // Default live-game sub-tab ("Picks"): starts on the game's leader (Bob) with inline actual stats
  // so players immediately see why each pick is winning or losing.
  await expect(viewer.getByTestId('tg-subtab-picks')).toHaveAttribute('aria-selected', 'true');
  await expect(viewer.getByTestId('tg-reveal-player').locator('option:checked')).toHaveText('Bob');
  await expect(viewer.getByTestId('tg-pick-firstTeam')).toHaveClass(/tg-pick-lost/);
  await expect(viewer.getByTestId('tg-pick-punts')).toHaveClass(/tg-pick-lead/); // live lead, not banked yet
  await expect(viewer.getByTestId('tg-pick-actual-punts')).toHaveText('So far: 7');
  await expect(viewer.getByTestId('tg-pick-sacks')).not.toHaveClass(/tg-pick-lost/); // still live

  // Switch to "By Category": Bob is right on punts; expanding shows every family member's pick.
  await viewer.getByTestId('tg-subtab-categories').click();
  await expect(viewer.getByTestId('tg-subtab-categories')).toHaveAttribute('aria-selected', 'true');
  const punts = viewer.getByTestId('tg-cat-punts');
  await expect(punts).toContainText('Bob');
  await expect(punts).toContainText('7');
  await punts.getByRole('button').click();
  await expect(punts).toContainText('Total punts');
  const puntsPicks = viewer.getByTestId('tg-cat-picks-punts');
  await expect(puntsPicks).toContainText('Bob');
  await expect(puntsPicks).toContainText('+3');
  await expect(puntsPicks).toContainText('Alice');
  await expect(puntsPicks).toContainText('4');

  // Standings: explicitly labeled Live and Banked columns with sort toggle; Bob leads on live pace
  // (3 live, 0 banked), and expanding Bob shows "—" instead of "0" for unstarted Game 2.
  const standings = viewer.getByTestId('tg-standings');
  await expect(standings.getByTestId('tg-standings-sort')).toBeVisible();
  await expect(viewer.getByTestId('tg-total-Bob')).toHaveText('3');
  await expect(viewer.getByTestId('tg-locked-Bob')).toHaveText('0');
  await standings.getByRole('button', { name: /Bob/ }).click();
  await expect(standings.locator('.tg-board-games')).toContainText('PHI @ DAL');
  await expect(standings.locator('.tg-board-games')).toContainText('—');

  // On mobile (Pixel 7), switching to an open game auto-collapses Standings to a compact summary
  // bar so the open game stays above the fold; tapping it expands Standings again.
  await viewer.getByRole('button', { name: /PHI @ DAL/ }).click();
  await expect(viewer.getByTestId('tg-standings-toggle')).toHaveAttribute('aria-expanded', 'false');
  await viewer.getByTestId('tg-standings-toggle').click();
  await expect(viewer.getByTestId('tg-standings-toggle')).toHaveAttribute('aria-expanded', 'true');
  await viewer.getByRole('button', { name: /CHI @ DET/ }).click();

  // The full-screen scoreboard, from the menu (no sign-in needed): every category with who's right
  // and its status, and Live/Banked standings at the side. Exit closes it.
  await viewer.getByRole('button', { name: 'Menu' }).click();
  await viewer.getByRole('menuitem', { name: 'Full screen scoreboard' }).click();
  const tv = viewer.getByTestId('tg-tv');
  await expect(tv).toBeVisible();
  await expect(tv.getByTestId('tg-tv-matchup')).toContainText(/Bears\s*10\s*–\s*14\s*Lions/);
  await expect(tv.getByTestId('tg-tv-cat-punts')).toContainText('Total punts');
  await expect(tv.getByTestId('tg-tv-cat-punts')).toContainText('Bob');
  await expect(tv.getByTestId('tg-tv-cat-punts')).toContainText('Live');
  await expect(tv.getByTestId('tg-tv-cat-firstTeam')).toContainText('Final');
  await expect(tv.getByTestId('tg-tv-standings')).toContainText('Live');
  await expect(tv.getByTestId('tg-tv-standings')).toContainText('Banked');
  await expect(tv.getByTestId('tg-tv-standings')).toContainText('Bob');
  await tv.getByRole('button', { name: 'Exit full screen' }).click();
  await expect(tv).toHaveCount(0);

  // Wide tables scroll inside their own box; the page itself never scrolls sideways on a phone.
  for (const p of [admin, viewer]) {
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }

  // Every change is in the log.
  await expect(admin.getByTestId('tg-admin-log')).toContainText('setOverride');
  await expect(admin.getByTestId('tg-admin-log')).toContainText('rescore');
});

test("someone else's email can't use the admin screen", async ({ browser }) => {
  await loadRulesWithAdmin();
  await seed();
  const page = await (await browser.newContext()).newPage();
  await page.goto('/thanksgiving/admin');
  await page.getByLabel('Email').fill('eve@example.com');
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByRole('status')).toContainText('Check your email');
  const codes = await (await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/oobCodes`)).json();
  const code = codes.oobCodes.find((c: { email: string }) => c.email === 'eve@example.com');
  await page.goto(`/thanksgiving/admin?mode=signIn&oobCode=${code.oobCode}&apiKey=demo-key&lang=en`);
  await expect(page.getByRole('alert')).toContainText("This account isn't the admin");
  await page.getByRole('button', { name: 'Re-run scoring' }).click();
  await expect(page.getByText('Only the admin can do that.')).toBeVisible();
});
