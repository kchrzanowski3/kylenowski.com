// The test contest (docs/thanksgiving-spec.md, "Test contest") against the Firestore and Auth
// emulators: the same functions, run with the test contest, use only the tgTest* collections and
// the Nov 23 + Nov 25 scoreboards; Test1-Test10 exist only there; the real contest is unchanged.
import { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';
import { adminAction } from '../../functions/src/admin';
import { ensurePlayer, joinPlayer, loginPlayer } from '../../functions/src/auth';
import { publish, runLive } from '../../functions/src/live';
import { QUESTION_COUNT, answerProblems, answeredCount } from '../../src/lib/thanksgiving/questions';
import { runPregameRefresh, type FetchJson } from '../../functions/src/refresh';
import { REAL_CONTEST, TEST_CONTEST } from '../../src/lib/thanksgiving/config';
import { load } from '../unit/fixtures';
import { auth, clearFirestore, db } from './admin-app';

const MON_GAME = '401873081'; // recorded as CHI @ DET; served here as Monday night's game
const WED_GAME = '401873082'; // recorded as KC @ BUF; served here as Wednesday night's game
const TUE_GAME = '401873080'; // on the Nov 25 scoreboard but Tuesday night in ET: not in the contest

/** Moves a recorded Thanksgiving event to another kickoff. */
function at(event: any, iso: string) {
  const e = structuredClone(event);
  e.date = iso;
  e.competitions[0].date = iso;
  return e;
}

/** A fake ESPN with the test contest's two scoreboards (and Thursday's, for the real contest). */
function fakeEspn() {
  const calls: string[] = [];
  const thursday = load('scoreboard-2026-11-26.json');
  const byId = (id: string) => thursday.events.find((e: any) => String(e.id) === id);
  const fetchJson: FetchJson = async (url) => {
    calls.push(url);
    if (url.includes('scoreboard?dates=20261126')) return thursday;
    if (url.includes('scoreboard?dates=20261123')) return { events: [at(byId(MON_GAME), '2026-11-24T01:15Z')] };
    if (url.includes('scoreboard?dates=20261125')) {
      return { events: [at(byId(WED_GAME), '2026-11-26T01:00Z'), at(byId(TUE_GAME), '2026-11-25T03:00Z')] };
    }
    if (/seasontype=2&week=\d+/.test(url)) return { events: [] };
    if (url.includes('/depthcharts')) return load('depthchart-dal.json');
    if (url.includes('/roster')) return load('roster-dal.json');
    throw new Error(`unexpected fetch ${url}`);
  };
  return { fetchJson, calls };
}

const SUNDAY = Date.parse('2026-11-22T18:00:00Z');
const ids = async (collection: string) => (await db.collection(collection).get()).docs.map((d) => d.id).sort();
const names = async (collection: string) => (await db.collection(collection).get()).docs.map((d) => d.get('name')).sort();
const REAL_COLLECTIONS = ['tgGames', 'tgPlayers', 'tgSecrets', 'tgNames', 'tgLive', 'tgOverrides', 'tgResults', 'tgStandings', 'tgMeta', 'tgAdminLog', 'tgSeasonGames'];

async function expectRealUntouched() {
  for (const c of REAL_COLLECTIONS) expect(await ids(c), c).toEqual([]);
}

beforeEach(clearFirestore);

describe('test contest: pre-game refresh', () => {
  it("writes every game on the Nov 23 and Nov 25 scoreboards, by kickoff, to tgTestGames only", async () => {
    const espn = fakeEspn();
    const report = await runPregameRefresh(db, espn.fetchJson, () => SUNDAY, { contest: TEST_CONTEST });
    expect(report.games.map((g) => g.espnId)).toEqual([MON_GAME, WED_GAME]);
    expect(report.errors).toEqual([]);

    const games = (await db.collection('tgTestGames').orderBy('order').get()).docs;
    expect(games.map((d) => [d.id, d.get('order'), d.get('kickoff').toDate().toISOString()])).toEqual([
      [MON_GAME, 1, '2026-11-24T01:15:00.000Z'],
      [WED_GAME, 2, '2026-11-26T01:00:00.000Z'],
    ]);
    expect((await db.doc('tgTestMeta/refresh').get()).get('games')).toBe(2);
    expect(espn.calls.some((u) => u.includes('dates=20261126'))).toBe(false);
    await expectRealUntouched();
  });

  it('creates Test1-Test10 without PINs, once', async () => {
    const first = await runPregameRefresh(db, fakeEspn().fetchJson, () => SUNDAY, { contest: TEST_CONTEST });
    expect(first.seededPlayers).toEqual(TEST_CONTEST.seedPlayers);
    expect(await names('tgTestPlayers')).toEqual([...TEST_CONTEST.seedPlayers].sort());
    expect((await db.collection('tgTestPlayers').get()).docs.every((d) => d.get('hasPin') === false)).toBe(true);
    expect(await ids('tgTestNames')).toEqual(TEST_CONTEST.seedPlayers.map((n) => n.toLowerCase()).sort());

    const second = await runPregameRefresh(db, fakeEspn().fetchJson, () => SUNDAY + 3_600_000, { contest: TEST_CONTEST });
    expect(second.seededPlayers).toEqual([]);
    expect(await ids('tgTestPlayers')).toHaveLength(10);
  });

  it('a seed player can sign in without a PIN, in the test contest only', async () => {
    await runPregameRefresh(db, fakeEspn().fetchJson, () => SUNDAY, { contest: TEST_CONTEST });
    const test1 = (await db.collection('tgTestPlayers').where('name', '==', 'Test1').get()).docs[0];
    await expect(loginPlayer(db, auth, { playerId: test1.id }, SUNDAY, TEST_CONTEST)).resolves.toHaveProperty('token');
    await expect(loginPlayer(db, auth, { playerId: test1.id }, SUNDAY)).rejects.toMatchObject({ status: 404 });
  });

  it('re-creates a seed player the admin removed, on the next scheduled refresh', async () => {
    await runPregameRefresh(db, fakeEspn().fetchJson, () => SUNDAY, { contest: TEST_CONTEST });
    const test3 = (await db.collection('tgTestPlayers').where('name', '==', 'Test3').get()).docs[0];
    await adminAction(db, auth, 'admin@example.com', { action: 'removePlayer', playerId: test3.id }, SUNDAY, TEST_CONTEST);
    expect(await names('tgTestPlayers')).not.toContain('Test3');
    const again = await runPregameRefresh(db, fakeEspn().fetchJson, () => SUNDAY + 60_000, { contest: TEST_CONTEST });
    expect(again.seededPlayers).toEqual(['Test3']);
  });

  it('gives every seed player a full set of valid picks for every test game, once, keeping picks people made', async () => {
    const first = await runPregameRefresh(db, fakeEspn().fetchJson, () => SUNDAY, { contest: TEST_CONTEST });
    expect(first.seededPicks).toBe(20); // 10 players x 2 games
    const players = (await db.collection('tgTestPlayers').get()).docs;
    for (const game of [MON_GAME, WED_GAME]) {
      const picks = (await db.collection(`tgTestGames/${game}/picks`).get()).docs;
      expect(picks.map((d) => d.id).sort()).toEqual(players.map((d) => d.id).sort());
      for (const p of picks) {
        expect(answerProblems(p.get('answers'))).toEqual([]);
        expect(answeredCount(p.get('answers'))).toBe(QUESTION_COUNT);
      }
    }

    // Someone signs in as Test1 and changes Wednesday's picks; the next refresh leaves them alone.
    const test1 = players.find((d) => d.get('name') === 'Test1')!;
    await db.doc(`tgTestGames/${WED_GAME}/picks/${test1.id}`).set({ answers: { punts: 1 }, updatedAt: Timestamp.now() });
    const second = await runPregameRefresh(db, fakeEspn().fetchJson, () => SUNDAY + 3_600_000, { contest: TEST_CONTEST });
    expect(second.seededPicks).toBe(0);
    expect((await db.doc(`tgTestGames/${WED_GAME}/picks/${test1.id}`).get()).get('answers')).toEqual({ punts: 1 });
  });

  it('seed picks are scored like anyone else\'s, so the test leaderboard fills in', async () => {
    await runPregameRefresh(db, fakeEspn().fetchJson, () => SUNDAY, { contest: TEST_CONTEST });
    const report = await publish(db, Date.parse('2026-11-24T02:00:00Z'), undefined, TEST_CONTEST);
    expect(report.standingsChanged).toBe(true);
    const rows = (await db.doc('tgTestStandings/overall').get()).get('rows');
    expect(rows).toHaveLength(10);
  });

  it("the live worker's quick refresh doesn't seed players", async () => {
    const report = await runPregameRefresh(db, fakeEspn().fetchJson, () => SUNDAY, { contest: TEST_CONTEST, seasonAverages: false });
    expect(report.seededPlayers).toBeUndefined();
    expect(await ids('tgTestPlayers')).toEqual([]);
  });
});

describe('the real contest is unchanged', () => {
  it('refreshes only Thursday into the tg* collections, and never creates test players', async () => {
    const espn = fakeEspn();
    const report = await runPregameRefresh(db, espn.fetchJson, () => SUNDAY);
    expect(report.games.map((g) => g.matchup)).toEqual(['CHI @ DET', 'PHI @ DAL', 'KC @ BUF']);
    expect(report.seededPlayers).toBeUndefined();
    expect(espn.calls.filter((u) => u.includes('scoreboard?dates=2026112'))).toEqual([
      'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20261126',
    ]);
    expect(await ids('tgPlayers')).toEqual([]);
    expect(await ids('tgNames')).toEqual([]);
    for (const c of ['tgTestGames', 'tgTestPlayers', 'tgTestMeta']) expect(await ids(c), c).toEqual([]);
    expect(report.seededPicks).toBeUndefined();
    for (const g of await ids('tgGames')) expect(await ids(`tgGames/${g}/picks`), g).toEqual([]);
  });

  it('seed players can never be created in the real contest', async () => {
    await expect(ensurePlayer(db, REAL_CONTEST, 'Test1', SUNDAY)).rejects.toThrow(/seed player/);
    await expect(ensurePlayer(db, TEST_CONTEST, 'Kyle', SUNDAY)).rejects.toThrow(/seed player/);
    expect(await ids('tgPlayers')).toEqual([]);
  });
});

describe('test contest: sign-in, live worker and admin', () => {
  it('joining the test contest uses its own players and name index, so a name can be in both', async () => {
    const test = await joinPlayer(db, auth, { name: 'Kyle' }, SUNDAY, TEST_CONTEST);
    expect(await ids('tgTestPlayers')).toEqual([test.playerId]);
    expect(await ids('tgPlayers')).toEqual([]);
    const real = await joinPlayer(db, auth, { name: 'Kyle' }, SUNDAY);
    expect(await ids('tgPlayers')).toEqual([real.playerId]);
    await expect(joinPlayer(db, auth, { name: 'kyle' }, SUNDAY, TEST_CONTEST)).rejects.toMatchObject({ status: 409 });
  });

  it("joining the test contest closes at its last game's kickoff", async () => {
    await runPregameRefresh(db, fakeEspn().fetchJson, () => SUNDAY, { contest: TEST_CONTEST });
    const afterMonday = Date.parse('2026-11-24T02:00:00Z');
    await expect(joinPlayer(db, auth, { name: 'Late' }, afterMonday, TEST_CONTEST)).resolves.toHaveProperty('playerId');
    const afterWednesday = Date.parse('2026-11-26T01:00:01Z');
    await expect(joinPlayer(db, auth, { name: 'Later' }, afterWednesday, TEST_CONTEST)).rejects.toMatchObject({ status: 403 });
  });

  it('the live worker polls both test scoreboards and publishes to tgTest* only', async () => {
    const team = (id: string, abbr: string) => ({ id, abbr, name: abbr, shortName: abbr, color: null });
    const T = Date.parse('2026-11-24T03:00:00Z'); // Monday's game is on
    await db.doc('tgTestGames/g1').set({ order: 1, kickoff: Timestamp.fromMillis(T - 3_600_000), away: team('18', 'NO'), home: team('3', 'CHI'), scorers: [] });
    await db.doc('tgTestPlayers/ann').set({ name: 'Ann', hasPin: false });
    await db.doc('tgTestGames/g1/picks/ann').set({ answers: { punts: 6 } });
    const calls: string[] = [];
    const fetchJson: FetchJson = async (url) => {
      calls.push(url);
      if (url.includes('scoreboard?dates=20261123')) {
        return { events: [{ id: 'g1', competitions: [{ status: { period: 3, displayClock: '5:00', type: { state: 'in', name: 'STATUS_IN_PROGRESS' } } }] }] };
      }
      if (url.includes('scoreboard?dates=20261125')) return { events: [] };
      if (url.includes('summary?event=g1')) return load('summary-no-at-chi-2026-wk11-safety.json');
      if (url.includes('/plays/')) return {};
      throw new Error(`unexpected ${url}`);
    };

    const report = await runLive(db, fetchJson, { holder: 'h', budgetMs: 0, clock: () => T, sleep: async () => {}, contest: TEST_CONTEST });
    expect(report).toMatchObject({ ran: true, polls: 1, errors: [] });
    expect(calls.filter((u) => u.includes('scoreboard'))).toHaveLength(2);
    expect((await db.doc('tgTestLive/g1').get()).get('feed')).toMatchObject({ state: 'in', punts: 6 });
    expect((await db.doc('tgTestResults/g1').get()).get('score').totals.ann).toBeGreaterThan(0);
    expect((await db.doc('tgTestStandings/overall').get()).get('rows')).toHaveLength(1);
    expect((await db.doc('tgTestMeta/worker').get()).exists).toBe(true);
    await expectRealUntouched();
  });

  it("admin changes to the test contest go to its collections and log", async () => {
    await runPregameRefresh(db, fakeEspn().fetchJson, () => SUNDAY, { contest: TEST_CONTEST });
    await adminAction(db, auth, 'admin@example.com', { action: 'setSpoilerDelay', seconds: 30 }, SUNDAY, TEST_CONTEST);
    await adminAction(db, auth, 'admin@example.com', { action: 'setPaused', gameId: MON_GAME, paused: true }, SUNDAY, TEST_CONTEST);
    expect((await db.doc('tgTestMeta/config').get()).get('spoilerDelaySec')).toBe(30);
    expect((await db.doc(`tgTestOverrides/${MON_GAME}`).get()).get('paused')).toBe(true);
    expect(await ids('tgTestAdminLog')).toHaveLength(2);
    await expect(adminAction(db, auth, 'admin@example.com', { action: 'setPaused', gameId: MON_GAME, paused: true }, SUNDAY)).rejects.toMatchObject({ status: 404 });
    await expectRealUntouched();
  });
});
