// The practice games (docs/thanksgiving-spec.md, "Practice games") against the Firestore and Auth
// emulators: until 6:00 AM ET Thursday the real contest also has the Mon Nov 23 and Wed Nov 25
// games and the practice players Test1-Test10 (with seed picks for the practice games); the first
// refresh after that removes the practice games and players and keeps everything real.
import { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';
import { ensurePlayer, joinPlayer } from '../../functions/src/auth';
import { pollFeed, publish } from '../../functions/src/live';
import { runPregameRefresh, type FetchJson } from '../../functions/src/refresh';
import { CUTOVER_MS, PRACTICE, PRACTICE_CONTEST, THANKSGIVING_CONTEST } from '../../src/lib/thanksgiving/config';
import { QUESTION_COUNT, answerProblems, answeredCount } from '../../src/lib/thanksgiving/questions';
import { load } from '../unit/fixtures';
import { auth, clearFirestore, db } from './admin-app';

const MON = '401999123'; // Monday night's practice game
const WED = '401999125'; // Wednesday night's practice game
const THU = ['401873081', '401873080', '401873082']; // CHI @ DET, PHI @ DAL, KC @ BUF

/** A recorded Thanksgiving event, as another game at another kickoff. */
function as(event: any, id: string, iso: string) {
  const e = structuredClone(event);
  e.id = id;
  e.date = iso;
  e.competitions[0].date = iso;
  return e;
}

/** A fake ESPN with the two practice scoreboards and Thursday's. */
function fakeEspn() {
  const calls: string[] = [];
  const thursday = load('scoreboard-2026-11-26.json');
  const fetchJson: FetchJson = async (url) => {
    calls.push(url);
    if (url.includes('scoreboard?dates=20261126')) return thursday;
    if (url.includes('scoreboard?dates=20261123')) return { events: [as(thursday.events[0], MON, '2026-11-24T01:15Z')] };
    if (url.includes('scoreboard?dates=20261125')) {
      // A game that's Tuesday night in ET is on this scoreboard too; it isn't a practice game.
      return { events: [as(thursday.events[2], WED, '2026-11-26T01:00Z'), as(thursday.events[1], '401999124', '2026-11-25T03:00Z')] };
    }
    if (/seasontype=2&week=\d+/.test(url)) return { events: [] };
    if (url.includes('/depthcharts')) return load('depthchart-dal.json');
    if (url.includes('/roster')) return load('roster-dal.json');
    throw new Error(`unexpected fetch ${url}`);
  };
  return { fetchJson, calls };
}

const SUNDAY = Date.parse('2026-11-22T18:00:00Z');
const MONDAY_NIGHT = Date.parse('2026-11-24T02:00:00Z'); // 9:00 PM ET Monday
const ids = async (path: string) => (await db.collection(path).get()).docs.map((d) => d.id).sort();
const playerId = async (name: string) => (await db.collection('tgPlayers').where('name', '==', name).get()).docs[0]?.id;

beforeEach(clearFirestore);

describe('during the practice', () => {
  it('the real contest has the practice games and the Thursday games, numbered by kickoff', async () => {
    const espn = fakeEspn();
    const report = await runPregameRefresh(db, espn.fetchJson, () => SUNDAY);
    expect(report.games.map((g) => g.espnId)).toEqual([MON, WED, ...THU]);
    const games = (await db.collection('tgGames').orderBy('order').get()).docs;
    expect(games.map((d) => [d.id, d.get('order')])).toEqual([[MON, 1], [WED, 2], [THU[0], 3], [THU[1], 4], [THU[2], 5]]);
    expect(espn.calls.filter((u) => u.includes('scoreboard?dates=2026112')).map((u) => u.slice(-8))).toEqual(['20261123', '20261125', '20261126']);
  });

  it('creates Test1-Test10 without PINs, once', async () => {
    const first = await runPregameRefresh(db, fakeEspn().fetchJson, () => SUNDAY);
    expect(first.seededPlayers).toEqual([...PRACTICE.players]);
    const players = (await db.collection('tgPlayers').get()).docs;
    expect(players.map((d) => d.get('name')).sort()).toEqual([...PRACTICE.players].sort());
    expect(players.every((d) => d.get('hasPin') === false)).toBe(true);
    const second = await runPregameRefresh(db, fakeEspn().fetchJson, () => SUNDAY + 3_600_000);
    expect(second.seededPlayers).toEqual([]);
    expect(await ids('tgPlayers')).toHaveLength(10);
  });

  it('gives each practice player full, valid picks for the practice games only, once, never replacing a person\'s picks', async () => {
    const first = await runPregameRefresh(db, fakeEspn().fetchJson, () => SUNDAY);
    expect(first.seededPicks).toBe(20); // 10 players x 2 practice games
    const players = await ids('tgPlayers');
    for (const game of [MON, WED]) {
      const picks = (await db.collection(`tgGames/${game}/picks`).get()).docs;
      expect(picks.map((d) => d.id).sort()).toEqual(players);
      for (const p of picks) {
        expect(answerProblems(p.get('answers'))).toEqual([]);
        expect(answeredCount(p.get('answers'))).toBe(QUESTION_COUNT);
      }
    }
    for (const game of THU) expect(await ids(`tgGames/${game}/picks`), game).toEqual([]);

    const test1 = await playerId('Test1');
    await db.doc(`tgGames/${WED}/picks/${test1}`).set({ answers: { punts: 1 }, updatedAt: Timestamp.now() });
    const second = await runPregameRefresh(db, fakeEspn().fetchJson, () => SUNDAY + 3_600_000);
    expect(second.seededPicks).toBe(0);
    expect((await db.doc(`tgGames/${WED}/picks/${test1}`).get()).get('answers')).toEqual({ punts: 1 });
  });

  it('practice picks are scored into the standings', async () => {
    await runPregameRefresh(db, fakeEspn().fetchJson, () => SUNDAY);
    const report = await publish(db, MONDAY_NIGHT);
    expect(report.standingsChanged).toBe(true);
    expect((await db.doc('tgStandings/overall').get()).get('rows')).toHaveLength(10);
  });

  it("the live worker's per-minute refresh doesn't seed players or picks", async () => {
    const report = await runPregameRefresh(db, fakeEspn().fetchJson, () => SUNDAY, { seasonAverages: false });
    expect(report.seededPlayers).toBeUndefined();
    expect(report.seededPicks).toBeUndefined();
    expect(await ids('tgPlayers')).toEqual([]);
  });

  it('the live worker polls the practice scoreboards', async () => {
    await runPregameRefresh(db, fakeEspn().fetchJson, () => SUNDAY);
    const espn = fakeEspn();
    const games = (await db.collection('tgGames').orderBy('order').get()).docs.map((d) => ({
      id: d.id, order: d.get('order'), kickoff: d.get('kickoff').toMillis(), away: d.get('away'), home: d.get('home'), scorers: d.get('scorers'),
    }));
    await pollFeed(db, espn.fetchJson, MONDAY_NIGHT, games).catch(() => {});
    expect(espn.calls.some((u) => u.includes('scoreboard?dates=20261123'))).toBe(true);
  });

  it('only the practice names can be seeded, and none once the practice is over', async () => {
    await expect(ensurePlayer(db, PRACTICE_CONTEST, 'Kyle', SUNDAY)).rejects.toThrow(/practice player/);
    await expect(ensurePlayer(db, THANKSGIVING_CONTEST, 'Test1', SUNDAY)).rejects.toThrow(/practice player/);
    expect(await ids('tgPlayers')).toEqual([]);
  });
});

describe('the end of the practice (6:00 AM ET Thursday)', () => {
  /** The practice as it stands Wednesday night: games, practice players, a real player, results. */
  async function practiceWeek() {
    await runPregameRefresh(db, fakeEspn().fetchJson, () => SUNDAY);
    const kyle = await joinPlayer(db, auth, { name: 'Kyle', pin: '1234' }, SUNDAY);
    const answers = { punts: 7 };
    for (const g of [MON, WED, THU[0]]) await db.doc(`tgGames/${g}/picks/${kyle.playerId}`).set({ answers, updatedAt: Timestamp.now() });
    // Someone signed in as Test1 and picked a Thursday game too.
    await db.doc(`tgGames/${THU[1]}/picks/${await playerId('Test1')}`).set({ answers, updatedAt: Timestamp.now() });
    for (const c of ['tgLive', 'tgOverrides', 'tgResults']) await db.doc(`${c}/${MON}`).set({ x: 1 });
    await publish(db, MONDAY_NIGHT);
    return kyle.playerId;
  }

  it('removes the practice games, with their picks, live values, overrides and results', async () => {
    await practiceWeek();
    const report = await runPregameRefresh(db, fakeEspn().fetchJson, () => CUTOVER_MS);
    expect(report.removedGames?.sort()).toEqual([MON, WED].sort());
    const games = (await db.collection('tgGames').orderBy('order').get()).docs;
    expect(games.map((d) => [d.id, d.get('order')])).toEqual([[THU[0], 1], [THU[1], 2], [THU[2], 3]]);
    for (const g of [MON, WED]) expect(await ids(`tgGames/${g}/picks`), g).toEqual([]);
    for (const c of ['tgLive', 'tgOverrides', 'tgResults']) expect((await db.doc(`${c}/${MON}`).get()).exists, c).toBe(false);
  });

  it('removes Test1-Test10 and all their picks, and keeps real players with their Thursday picks', async () => {
    const kyle = await practiceWeek();
    const report = await runPregameRefresh(db, fakeEspn().fetchJson, () => CUTOVER_MS);
    expect(report.removedPlayers).toEqual([...PRACTICE.players]);
    expect(await ids('tgPlayers')).toEqual([kyle]);
    expect(await ids('tgNames')).toEqual(['kyle']);
    expect(await ids('tgSecrets')).toEqual([kyle]);
    expect(await ids(`tgGames/${THU[0]}/picks`)).toEqual([kyle]);
    expect(await ids(`tgGames/${THU[1]}/picks`)).toEqual([]); // Test1's Thursday pick is gone
    expect((await db.doc(`tgPlayers/${kyle}`).get()).get('hasPin')).toBe(true);
  });

  it('clears the practice standings, and the next run removes nothing more', async () => {
    await practiceWeek();
    expect((await db.doc('tgStandings/overall').get()).exists).toBe(true);
    await runPregameRefresh(db, fakeEspn().fetchJson, () => CUTOVER_MS);
    expect((await db.doc('tgStandings/overall').get()).exists).toBe(false);
    const again = await runPregameRefresh(db, fakeEspn().fetchJson, () => CUTOVER_MS + 3_600_000);
    expect(again.removedGames).toBeUndefined();
    expect(again.removedPlayers).toBeUndefined();
    expect(again.seededPlayers).toBeUndefined();
    expect(await ids('tgGames')).toEqual([...THU].sort());
  });

  it("the live worker's per-minute refresh doesn't remove anything (the scheduled runs do)", async () => {
    await practiceWeek();
    await runPregameRefresh(db, fakeEspn().fetchJson, () => CUTOVER_MS, { seasonAverages: false });
    expect(await ids('tgGames')).toHaveLength(5);
  });

  it('a game whose day is unknown is kept', async () => {
    await db.doc('tgGames/odd').set({ order: 9 });
    await runPregameRefresh(db, fakeEspn().fetchJson, () => CUTOVER_MS);
    expect(await ids('tgGames')).toContain('odd');
  });
});
