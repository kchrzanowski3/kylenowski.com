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
  await seed(120_000);

  // Alice joins with a PIN and makes some picks for game 1.
  const alice = await (await browser.newContext()).newPage();
  const csp = watchCsp(alice);
  await join(alice, 'Alice', '1234');
  await expect(alice.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  // The final-score question shows the Vegas projection; number questions show the NFL average per game
  // (twice the per-team average), and the longest TD the per-team one.
  await expect(alice.locator('.tg-vegas')).toContainText('Vegas projects CHI 29 – DET 26.5');
  await expect(alice.getByText('NFL average 8 per game')).toBeVisible();
  await expect(alice.getByText('NFL team average longest TD: 31.5 yards')).toBeVisible();
  await expect(alice.getByText('3 points (closest pick wins)').first()).toBeVisible();
  await expect(alice.getByText(/each team’s own|Can't be a tie/)).toHaveCount(0);
  await alice.getByLabel('CHI final score').fill('20');
  await alice.getByLabel('DET final score').fill('20');
  await expect(alice.getByTestId('tg-save-status')).toContainText("Saved, except the final score: it can’t be a tie");
  await alice.getByLabel('DET final score').fill('27');
  await alice.getByRole('group', { name: /Which team scores first/ }).getByRole('button', { name: 'DET' }).click();
  await alice.getByLabel('First TD scorer').selectOption({ label: 'Jahmyr Gibbs (RB)' });
  await alice.getByLabel('Total punts').fill('8');
  await expect(alice.getByTestId('tg-save-status')).toContainText('Saved ✓');
  await expect(alice.getByTestId('tg-save-status')).toContainText('4 of 15 answered');

  // Each game's tab shows how many of your picks are made, and an open lock until kickoff.
  await expect(alice.getByTestId('tg-progress-g1')).toHaveAttribute('aria-valuenow', '4');
  await expect(alice.getByTestId('tg-progress-g2')).toHaveAttribute('aria-valuenow', '0');
  await expect(alice.getByRole('button', { name: /CHI @ DET/ }).locator('[data-phase]')).toHaveAttribute('data-phase', 'open');
  await expect(alice.getByTestId('tg-lock-status')).toHaveAttribute('data-phase', 'open');

  // Your account is in the menu at the top right.
  await alice.getByRole('button', { name: 'Account: Alice' }).click();
  await expect(alice.getByRole('menu', { name: 'Account' })).toContainText('Alice');
  await expect(alice.getByRole('menuitem', { name: 'Change PIN' })).toBeVisible();
  await expect(alice.getByRole('menuitem', { name: 'Switch player' })).toBeVisible();
  await alice.keyboard.press('Escape');
  await expect(alice.getByRole('menu', { name: 'Account' })).toHaveCount(0);

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

  // Alice on a second phone: her name needs the PIN (shown with a key icon, not a lock emoji), and her saved picks are there.
  const alice2 = await (await browser.newContext()).newPage();
  await alice2.goto('/thanksgiving');
  const aliceChip = alice2.getByRole('button', { name: /^Alice/ });
  await expect(aliceChip).not.toContainText('🔒');
  await expect(aliceChip.getByRole('img', { name: 'has a PIN' })).toBeVisible();
  await aliceChip.click();
  await alice2.getByLabel('PIN for Alice').fill('9999');
  await alice2.getByRole('button', { name: 'Sign in' }).click();
  await expect(alice2.getByRole('alert')).toContainText('Wrong PIN');
  await alice2.getByLabel('PIN for Alice').fill('1234');
  await alice2.getByRole('button', { name: 'Sign in' }).click();
  await expect(alice2.getByTestId('tg-me')).toHaveText('Alice');
  await expect(alice2.getByLabel('Total punts')).toHaveValue('8');

  // Before kickoff, Bob's view shows no one else's picks.
  await expect(bob.getByTestId('tg-reveal')).toHaveCount(0);

  // Kickoff: move kickoff 2s ahead so every open browser receives the update before the 1s clock
  // tick, then verify picks lock and everyone's are revealed without a refresh.
  const lockAt = Date.now() + 2_000;
  await db.doc('tgGames/g1').update({ kickoff: Timestamp.fromMillis(lockAt) });
  await alice.waitForTimeout(Math.max(0, lockAt - Date.now()));
  for (const page of [alice, bob, carol]) {
    // A live badge on its tab and in the game's header.
    await expect(page.getByTestId('tg-lock-status')).toHaveAttribute('data-phase', 'live', { timeout: 15_000 });
    await expect(page.getByTestId('tg-lock-status')).toHaveText('Live');
    await expect(page.getByRole('button', { name: /CHI @ DET/ }).locator('[data-phase]')).toHaveAttribute('data-phase', 'live');
    // Pick a player from the list to see their picks.
    const picks = page.getByTestId('tg-reveal');
    await expect(picks).toBeVisible({ timeout: 15_000 });
    const player = page.getByTestId('tg-reveal-player');
    await expect(player.locator('option')).toHaveCount(2, { timeout: 10_000 });
    // It starts on you (Carol hasn't joined, so she starts on the game's leader, or the first player).
    await expect(player.locator('option:checked')).toHaveText(page === bob ? 'Bob (you)' : page === alice ? 'Alice (you)' : 'Alice');
    const aliceValue = await player.locator('option', { hasText: 'Alice' }).getAttribute('value');
    await player.selectOption(aliceValue!);
    await expect(picks).toContainText('CHI 20 – DET 27');
    await expect(picks).toContainText('Jahmyr Gibbs');
  }

  // Someone who joins after kickoff, with no picks for this game, still starts on themselves.
  const dan = await (await browser.newContext()).newPage();
  await join(dan, 'Dan');
  await dan.getByRole('button', { name: /CHI @ DET/ }).click();
  await expect(dan.getByTestId('tg-reveal-player').locator('option:checked')).toHaveText('Dan (you)');
  await expect(dan.getByTestId('tg-reveal')).toContainText('No picks for this game.');

  // A phone opening the page now lands on the game being played, not the next one to pick.
  const late = await (await browser.newContext()).newPage();
  await late.goto('/thanksgiving');
  await expect(late.getByRole('button', { name: /CHI @ DET/ })).toHaveAttribute('aria-current', 'page');
  await expect(bob.getByLabel('Total punts')).toHaveCount(0); // the form is gone
  // The page never scrolls sideways on a phone.
  expect(await alice.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // Game 2 is still open for late arrivals.
  await bob.getByRole('button', { name: /PHI @ DAL/ }).click();
  await expect(bob.getByTestId('tg-lock-status')).toHaveAttribute('data-phase', 'open');
  await expect(bob.getByLabel('Total punts')).toBeVisible();

  expect(csp).toEqual([]);
});

test('pick form fits mobile viewports without horizontal overflow', async ({ page }) => {
  await seed(3_600_000);
  await join(page, 'Kyle');
  await expect(page.getByRole('group', { name: /Final score/ })).toBeVisible();

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      maxCardRight: Math.max(...[...document.querySelectorAll('.tg-q')].map((el) => Math.ceil(el.getBoundingClientRect().right))),
    }));
    expect(overflow.scrollWidth, `page overflow at ${width}px`).toBeLessThanOrEqual(width);
    expect(overflow.maxCardRight, `question card overflow at ${width}px`).toBeLessThanOrEqual(width);
  }
});

test('completing all 15 picks celebrates and offers seamless jump to next open game', async ({ page }) => {
  await seed(3_600_000);
  await join(page, 'Kyle');
  // Standalone game-day page omits the blog nav back-link.
  await expect(page.locator('.site-nav')).toHaveCount(0);

  await page.getByLabel('CHI final score').fill('20');
  await page.getByLabel('DET final score').fill('27');
  await page.getByRole('group', { name: /Which team scores first/ }).getByRole('button', { name: 'DET' }).click();
  await page.getByRole('group', { name: /How is the first score made/ }).getByRole('button', { name: 'TD' }).click();
  await page.getByLabel('First TD scorer').selectOption({ label: 'Jahmyr Gibbs (RB)' });
  await page.getByRole('group', { name: /Who's leading at halftime/ }).getByRole('button', { name: 'DET' }).click();
  await page.getByRole('group', { name: /Which team has more passing TDs/ }).getByRole('button', { name: 'DET' }).click();
  await page.getByRole('group', { name: /Which team has more rushing TDs/ }).getByRole('button', { name: 'CHI' }).click();
  await page.getByRole('group', { name: /Missed extra point/ }).getByRole('button', { name: 'No' }).click();
  await page.getByRole('group', { name: /Lead change in the 4th quarter/ }).getByRole('button', { name: 'Yes' }).click();
  await page.getByLabel('Total field goals made').fill('3');
  await page.getByLabel('Total punts').fill('7');
  await page.getByLabel('Total touchdowns').fill('6');
  await page.getByLabel('Combined turnovers').fill('2');
  await page.getByLabel('Yards on the longest TD').fill('42');
  await page.getByLabel('Combined sacks').fill('5');

  await expect(page.getByTestId('tg-picks-complete')).toBeVisible();
  await expect(page.getByTestId('tg-next-game')).toContainText('PHI @ DAL (0/15)');
  await page.getByTestId('tg-next-game').click();
  await expect(page.getByRole('button', { name: /PHI @ DAL/ })).toHaveAttribute('aria-current', 'page');
});

test('pick form sections, numeric steppers, inline errors, jump helper, and 44px touch targets', async ({ page }) => {
  await seed(3_600_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await join(page, 'Kyle');

  // 3 lightweight sections with live answered counts.
  await expect(page.getByTestId('tg-section-score-firsts')).toContainText('Score & Firsts');
  await expect(page.getByTestId('tg-section-score-firsts')).toContainText('0/4');
  await expect(page.getByTestId('tg-section-game-flow')).toContainText('Game Flow');
  await expect(page.getByTestId('tg-section-game-flow')).toContainText('0/5');
  await expect(page.getByTestId('tg-section-stat-totals')).toContainText('Stat Totals');
  await expect(page.getByTestId('tg-section-stat-totals')).toContainText('0/6');

  // No jump button at 0/15 with no errors.
  await expect(page.getByTestId('tg-jump-next')).toHaveCount(0);

  // Steppers on Q10-Q15 start from the rounded NFL average on first tap (punts: 8, longestTd: 32).
  const puntsGroup = page.getByRole('group', { name: /Total punts/ });
  await puntsGroup.getByRole('button', { name: 'Increase by 1' }).click();
  await expect(page.getByLabel('Total punts')).toHaveValue('8');
  await puntsGroup.getByRole('button', { name: 'Increase by 1' }).click();
  await expect(page.getByLabel('Total punts')).toHaveValue('9');
  await puntsGroup.getByRole('button', { name: 'Decrease by 1' }).click();
  await expect(page.getByLabel('Total punts')).toHaveValue('8');

  // Longest TD supports both ±5 and ±1 steps, seeding at rounded NFL average 32.
  const longestTdGroup = page.getByRole('group', { name: /Yards on the longest TD/ });
  await longestTdGroup.getByRole('button', { name: 'Increase by 5' }).click();
  await expect(page.getByLabel('Yards on the longest TD')).toHaveValue('32');
  await longestTdGroup.getByRole('button', { name: 'Increase by 5' }).click();
  await expect(page.getByLabel('Yards on the longest TD')).toHaveValue('37');
  await longestTdGroup.getByRole('button', { name: 'Decrease by 1' }).click();
  await expect(page.getByLabel('Yards on the longest TD')).toHaveValue('36');
  await expect(page.getByTestId('tg-section-stat-totals')).toContainText('2/6');

  // Jump button appears once partially filled and focuses the next unanswered question (Q1).
  const jump = page.getByTestId('tg-jump-next');
  await expect(jump).toBeVisible();
  await expect(jump).toHaveAttribute('data-jump-kind', 'unanswered');
  await jump.click();
  await expect(page.getByLabel('CHI final score')).toBeFocused();

  // Out-of-range numeric entry shows plain-English inline error (never raw "fgs" key)
  // and switches the jump helper to prioritize the invalid question.
  await page.getByLabel('Total field goals made').fill('25');
  await expect(page.getByTestId('tg-err-fgs')).toHaveText('Enter a whole number from 0 to 20.');
  await expect(page.getByTestId('tg-save-status')).toContainText('Total field goals made: enter a whole number from 0 to 20.');
  await expect(page.getByTestId('tg-save-status')).not.toContainText(/\bfgs\b/);
  await expect(jump).toHaveAttribute('data-jump-kind', 'error');
  await jump.click();
  await expect(page.locator('[data-question="fgs"]')).toContainText('Enter a whole number from 0 to 20.');

  // Fixing the error restores valid status and clears inline error.
  await page.getByLabel('Total field goals made').fill('4');
  await expect(page.getByTestId('tg-err-fgs')).toHaveCount(0);
  await expect(page.getByTestId('tg-save-status')).toContainText('Saved ✓');
  await expect(page.getByTestId('tg-section-stat-totals')).toContainText('3/6');

  // All mobile interactive controls on the pick form meet the >=44px touch target floor.
  const tooSmall = await page.evaluate(() => {
    const selectors = ['.tg-choice button', '.tg-stepper-btn', '.tg-number', '.tg-pick-form .tg-select', '.tg-jump-btn', '.tg-avatar'];
    const issues: string[] = [];
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (r.height < 43.5 || r.width < 43.5) {
          issues.push(`${sel}: ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
      }
    }
    return issues;
  });
  expect(tooSmall).toEqual([]);

  // Game 2 has no NFL averages: tapping + on an empty stepper falls back to 0, then increments to 1.
  await page.getByRole('button', { name: /PHI @ DAL/ }).click();
  await page.getByRole('group', { name: /Total punts/ }).getByRole('button', { name: 'Increase by 1' }).click();
  await expect(page.getByLabel('Total punts')).toHaveValue('0');
  await page.getByRole('group', { name: /Total punts/ }).getByRole('button', { name: 'Increase by 1' }).click();
  await expect(page.getByLabel('Total punts')).toHaveValue('1');
});

test('masthead TV & Rules modal, PIN-less sign-in undo toast, and AccountMenu Cancel', async ({ page }) => {
  await seed(3_600_000);
  await join(page, 'Kyle');

  // Reorganized AccountMenu: player identity comes first, visual divider before TV, and Cancel on Add a PIN.
  await page.getByRole('button', { name: 'Account: Kyle' }).click();
  const menu = page.getByRole('menu', { name: 'Account' });
  const text = await menu.innerText();
  expect(text.indexOf('Kyle')).toBeLessThan(text.indexOf('Full screen scoreboard'));
  await expect(menu.locator('hr.tg-menu-divider')).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Add a PIN' }).click();
  await expect(menu.getByLabel('New 4-digit PIN')).toBeVisible();
  await menu.getByRole('button', { name: 'Cancel' }).click();
  await expect(menu.getByLabel('New 4-digit PIN')).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: 'Add a PIN' })).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Switch player' }).click();
  await expect(page.getByRole('heading', { name: 'Who are you?' })).toBeVisible();

  // Signed-out visitors can discover "How it works" and TV view directly from the masthead.
  await page.getByTestId('tg-rules-btn').click();
  const modal = page.getByTestId('tg-rules-modal');
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('Scoring & closest wins');
  await expect(modal).toContainText('Live vs. Banked points');
  await expect(modal).toContainText('Kickoff lock & reveal');
  await expect(modal).toContainText('Tiebreakers & champions');
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);

  await page.getByTestId('tg-tv-btn').click();
  await expect(page.getByTestId('tg-tv')).toBeVisible();
  await page.getByRole('button', { name: 'Exit full screen' }).click();
  await expect(page.getByTestId('tg-tv')).toHaveCount(0);

  // Tapping a PIN-less family chip shows an undo toast ("Signed in as Kyle — Switch").
  await page.getByRole('button', { name: 'Kyle' }).click();
  const toast = page.getByTestId('tg-signin-toast');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('Signed in as Kyle');
  await toast.getByRole('button', { name: 'Switch' }).click();
  await expect(page.getByRole('heading', { name: 'Who are you?' })).toBeVisible();

  // Sign back in and verify masthead controls fit cleanly at desktop & mobile widths without horizontal overflow.
  await page.getByRole('button', { name: 'Kyle' }).click();
  await expect(page.getByTestId('tg-me')).toHaveText('Kyle');
  for (const width of [1024, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, `overflow at ${width}px`).toBeLessThanOrEqual(width);
  }
});

test('demoAlerts=1 previews TV Last Big Play strip, sound toggle, mobile toast, and Recent updates strip', async ({ page }) => {
  await seed(3_600_000);
  await join(page, 'Kyle');
  // Demo bar is hidden during normal use.
  await expect(page.getByTestId('tg-demo-bar')).toHaveCount(0);

  // Opening with ?demoAlerts=1 enables preview triggers for mobile and TV.
  await page.goto('/thanksgiving?demoAlerts=1');
  await expect(page.getByTestId('tg-demo-bar')).toBeVisible();
  await page.getByTestId('tg-mobile-demo-alert').click();

  // Mobile toast appears and Recent updates strip captures it.
  const toast = page.getByTestId('tg-mobile-alert-toast');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('FIRST TD');
  await expect(toast).toContainText('Jahmyr Gibbs');

  const recent = page.getByTestId('tg-recent-updates');
  await expect(recent).toBeVisible();
  await page.getByTestId('tg-recent-toggle').click();
  await expect(recent).toContainText('First TD scorer');

  // Open TV view: persistent Last Big Play strip is visible, sound starts muted, and demo button cycles.
  await page.getByTestId('tg-tv-btn').click();
  const tv = page.getByTestId('tg-tv');
  await expect(tv).toBeVisible();
  await expect(tv.getByTestId('tg-tv-play-strip')).toContainText('FIRST TD');

  const soundBtn = tv.getByTestId('tg-tv-sound-toggle');
  await expect(soundBtn).toHaveAttribute('aria-pressed', 'false');
  await expect(tv.getByTestId('tg-tv-turducken-toggle')).toHaveCount(0);
  await soundBtn.click();
  await expect(soundBtn).toHaveAttribute('aria-pressed', 'true');
  const turduckenBtn = tv.getByTestId('tg-tv-turducken-toggle');
  await expect(turduckenBtn).toBeVisible();
  await expect(turduckenBtn).toHaveAttribute('aria-pressed', 'false');
  await turduckenBtn.click();
  await expect(turduckenBtn).toHaveAttribute('aria-pressed', 'true');

  // Cycling through Big Swing -> Halftime -> Game Final updates the persistent strip in place.
  await tv.getByTestId('tg-tv-demo-alert').click();
  await expect(tv.getByTestId('tg-tv-play-strip')).toContainText('TURNOVER');
  await tv.getByTestId('tg-tv-demo-alert').click();
  await expect(tv.getByTestId('tg-tv-play-strip')).toContainText('HALFTIME');
  await tv.getByTestId('tg-tv-demo-alert').click();
  await expect(tv.getByTestId('tg-tv-play-strip')).toContainText('FINAL');
});



