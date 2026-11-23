// The pre-game refresh against recorded ESPN feeds and the Firestore emulator
// (docs/thanksgiving-spec.md, "Pre-game refresh", "Locking and reveal" and Testing §5).
import { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';
import { runPregameRefresh, type FetchJson } from '../../functions/src/refresh';
import { load } from '../unit/fixtures';
import { clearFirestore, db } from './admin-app';

const SUMMARIES: Record<string, string> = {
  '401873070': 'summary-mia-at-buf-2026-wk11.json',
  '401872923': 'summary-no-at-det-2026-wk1-ot.json',
  '401873071': 'summary-no-at-chi-2026-wk11-safety.json',
  '401872959': 'summary-min-at-tb-2026-punt-return-td.json',
};

/** A fake ESPN: Thursday's scoreboard, the 4 recorded games as the whole season, and DAL's depth chart/roster for every team. */
function fakeEspn(overrides: { thursday?: (sb: any) => any } = {}) {
  const calls: string[] = [];
  const fetchJson: FetchJson = async (url) => {
    calls.push(url);
    if (url.includes('scoreboard?dates=20261126')) {
      const sb = load('scoreboard-2026-11-26.json');
      return overrides.thursday ? overrides.thursday(sb) : sb;
    }
    const week = /seasontype=2&week=(\d+)/.exec(url);
    if (week) {
      const events =
        week[1] === '11'
          ? Object.keys(SUMMARIES).map((id) => ({
              id,
              date: '2026-11-22T18:00Z',
              competitions: [{ status: { type: { completed: true } } }],
            }))
          : [];
      // A scheduled Thanksgiving-week game is listed too; it must be ignored.
      if (week[1] === '12') events.push({ id: '401873081', date: '2026-11-26T18:00Z', competitions: [{ status: { type: { completed: false } } }] });
      return { events };
    }
    const summary = /summary\?event=(\d+)/.exec(url);
    if (summary) return load(SUMMARIES[summary[1]]);
    if (url.includes('/depthcharts')) return load('depthchart-dal.json');
    if (url.includes('/roster')) return load('roster-dal.json');
    throw new Error(`unexpected fetch ${url}`);
  };
  return { fetchJson, calls };
}

const MONDAY = Date.parse('2026-11-23T14:00:00Z');
const GAME1 = '401873081'; // CHI @ DET, 1:00 PM ET
const GAME2 = '401873080'; // PHI @ DAL, 4:30 PM ET
const game = async (id: string) => (await db.doc(`tgGames/${id}`).get()).data()!;

beforeEach(clearFirestore);

describe('pre-game refresh', () => {
  it('writes the three Thursday games with lines, projections, lock times and scorer lists', async () => {
    const { fetchJson } = fakeEspn();
    const report = await runPregameRefresh(db, fetchJson, () => MONDAY);
    expect(report.games.map((g) => g.matchup)).toEqual(['CHI @ DET', 'PHI @ DAL', 'KC @ BUF']);
    expect(report.errors).toEqual([]);

    const g1 = await game(GAME1);
    expect(g1.order).toBe(1);
    expect(g1.tv).toBe('CBS');
    expect((g1.kickoff as Timestamp).toDate().toISOString()).toBe('2026-11-26T18:00:00.000Z');
    expect(g1.line).toMatchObject({ favorite: 'away', spread: 2.5, overUnder: 55.5 });
    expect(g1.projection).toEqual({ away: 29, home: 26.5 });
    expect(g1.scorers.filter((p: any) => p.side === 'home').map((p: any) => p.name)).toContain('Dak Prescott');
    expect(g1.scorers).toHaveLength(16);
  });

  it("computes each team's own season averages and the NFL average per team", async () => {
    const { fetchJson } = fakeEspn();
    const report = await runPregameRefresh(db, fetchJson, () => MONDAY);
    expect(report.seasonGames).toBe(4); // the scheduled Thanksgiving game isn't counted
    const g1 = await game(GAME1);
    // DET's one recorded game is the 31-30 overtime win over NO (7 punts, 5 sacks, longest TD 19).
    expect(g1.averages.home).toMatchObject({ games: 1, points: 31, punts: 7, sacks: 5, longestTd: 19, fgs: 1, tds: 4, turnovers: 1 });
    // CHI's is the 21-13 win over NO.
    expect(g1.averages.away).toMatchObject({ games: 1, points: 21, punts: 3, sacks: 6 });
    // 8 team-games; points 9+26+30+31+13+21+23+16 = 169.
    expect(g1.averages.nfl).toMatchObject({ games: 8, points: 21.1 });
    // No recorded games for PHI or DAL.
    expect((await game(GAME2)).averages).toMatchObject({ away: null, home: null });
  });

  it('caches season games, so a second run fetches no game summaries', async () => {
    await runPregameRefresh(db, fakeEspn().fetchJson, () => MONDAY);
    const second = fakeEspn();
    const report = await runPregameRefresh(db, second.fetchJson, () => MONDAY + 3_600_000);
    expect(report.newSeasonGames).toBe(0);
    expect(second.calls.some((u) => u.includes('summary?event='))).toBe(false);
  });

  it('follows a schedule change before kickoff', async () => {
    await runPregameRefresh(db, fakeEspn().fetchJson, () => MONDAY);
    const later = fakeEspn({
      thursday: (sb) => {
        sb.events[0].competitions[0].date = '2026-11-26T18:30Z';
        return sb;
      },
    });
    await runPregameRefresh(db, later.fetchJson, () => MONDAY);
    expect((await game(GAME1)).kickoff.toDate().toISOString()).toBe('2026-11-26T18:30:00.000Z');
  });

  it("freezes a game at kickoff: the lock never reopens, and the line and list don't change", async () => {
    await runPregameRefresh(db, fakeEspn().fetchJson, () => MONDAY);
    const before = await game(GAME1);
    const afterKickoff = Date.parse('2026-11-26T18:00:01Z');
    const moved = fakeEspn({
      thursday: (sb) => {
        sb.events[0].competitions[0].date = '2026-11-26T19:00Z'; // feed says it now starts later
        sb.events[0].competitions[0].odds[0].details = 'DET -1';
        return sb;
      },
    });
    const report = await runPregameRefresh(db, moved.fetchJson, () => afterKickoff);
    expect(report.games.find((g) => g.espnId === GAME1)?.frozen).toBe(true);
    const after = await game(GAME1);
    expect(after.kickoff.toMillis()).toBe(before.kickoff.toMillis());
    expect(after.line).toEqual(before.line);
    expect(after.refreshedAt.toMillis()).toBe(before.refreshedAt.toMillis());
    // Game 2 hasn't kicked off, so it still refreshes.
    expect(report.games.find((g) => g.espnId === GAME2)?.frozen).toBe(false);
  });

  it("keeps the admin's scorer-list edits and kickoff time", async () => {
    await runPregameRefresh(db, fakeEspn().fetchJson, () => MONDAY);
    const dak = (await game(GAME2)).scorers.find((p: any) => p.name === 'Dak Prescott');
    const added = { id: '999', name: 'Backup Hero', pos: 'WR', side: 'home' };
    const override = Timestamp.fromMillis(Date.parse('2026-11-26T22:00:00Z'));
    await db.doc(`tgGames/${GAME2}`).update({ scorerEdits: { added: [added], removed: [dak.id] }, kickoffOverride: override });

    await runPregameRefresh(db, fakeEspn().fetchJson, () => MONDAY + 60_000);
    const g2 = await game(GAME2);
    expect(g2.scorers.some((p: any) => p.id === dak.id)).toBe(false);
    expect(g2.scorers).toContainEqual(added);
    expect(g2.kickoff.toMillis()).toBe(override.toMillis());
    expect(g2.scorerEdits.removed).toEqual([dak.id]);
  });

  it('keeps the stored scorer list if the depth chart can\'t be fetched', async () => {
    await runPregameRefresh(db, fakeEspn().fetchJson, () => MONDAY);
    const broken = fakeEspn();
    const failing: FetchJson = async (url) => {
      if (url.includes('/depthcharts')) throw new Error('HTTP 503');
      return broken.fetchJson(url);
    };
    const report = await runPregameRefresh(db, failing, () => MONDAY + 60_000);
    expect(report.errors.some((e) => e.includes('scorer list'))).toBe(true);
    expect((await game(GAME1)).scorers).toHaveLength(16);
  });

  it('records when it last ran', async () => {
    await runPregameRefresh(db, fakeEspn().fetchJson, () => MONDAY);
    const meta = (await db.doc('tgMeta/refresh').get()).data()!;
    expect(meta).toMatchObject({ games: 3, seasonGames: 4, errors: [] });
  });
});
