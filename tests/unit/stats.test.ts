// Game stats from recorded 2026 games (docs/thanksgiving-spec.md, Testing §2). Expected values were
// worked out by hand from each game's scoring summary and box score, not from the code under test.
import { describe, expect, it } from 'vitest';
import { deriveGameStats, feedStatus, preGameStats, scorerIdFromCorePlay, scorerNameFromText, type FeedStatus } from '../../src/lib/thanksgiving/stats';
import { load } from './fixtures';

const FINAL: FeedStatus = { state: 'post', period: 4, clock: '0:00', name: 'STATUS_FINAL' };

describe('deriveGameStats on recorded games', () => {
  it('MIA @ BUF (9-26): field goals first, a missed FG, no 4th-quarter lead change', () => {
    const s = deriveGameStats(load('summary-mia-at-buf-2026-wk11.json'), FINAL);
    expect(s).toMatchObject({
      away: 9, home: 26,
      firstScore: { side: 'home', type: 'fg' },
      firstTd: { side: 'home', scorerName: 'DJ Moore', scorerId: null },
      halftimeReached: true, halftime: { away: 6, home: 20 },
      passTds: { away: 0, home: 1 }, rushTds: { away: 0, home: 1 },
      missedKick: true, // BUF 4 of 5 field goals
      leadChange4q: false,
      fgs: 7, punts: 4, tds: 2, turnovers: 3, longestTd: 4, sacks: 5,
    });
  });

  it('MIN @ TB (23-16): a punt-return TD is the first TD and the longest', () => {
    const s = deriveGameStats(load('summary-min-at-tb-2026-punt-return-td.json'), FINAL);
    expect(s).toMatchObject({
      away: 23, home: 16,
      firstScore: { side: 'away', type: 'fg' },
      firstTd: { side: 'away', scorerName: 'Myles Price' },
      halftime: { away: 17, home: 10 },
      passTds: { away: 1, home: 1 }, rushTds: { away: 0, home: 0 },
      missedKick: false, leadChange4q: false,
      fgs: 6, punts: 17, tds: 3, turnovers: 3, longestTd: 86, sacks: 9,
    });
  });

  it('NO @ CHI (13-21): a missed PAT counts as a missed kick; a safety is not a TD', () => {
    const s = deriveGameStats(load('summary-no-at-chi-2026-wk11-safety.json'), FINAL);
    expect(s).toMatchObject({
      away: 13, home: 21,
      firstScore: { side: 'home', type: 'fg' },
      firstTd: { side: 'home', scorerName: "D'Andre Swift" },
      halftime: { away: 10, home: 16 },
      passTds: { away: 1, home: 2 },
      missedKick: true, // CHI 1 of 2 extra points, NO 2 of 3 field goals
      fgs: 4, punts: 6, tds: 3, turnovers: 4, longestTd: 15, sacks: 8,
    });
  });

  it('NO @ DET (30-31 in OT): overtime counts in the stats, but not for the 4th-quarter lead change', () => {
    const s = deriveGameStats(load('summary-no-at-det-2026-wk1-ot.json'), { ...FINAL, period: 5 });
    expect(s).toMatchObject({
      away: 30, home: 31,
      firstScore: { side: 'home', type: 'td' },
      firstTd: { side: 'home', scorerName: 'Jahmyr Gibbs' },
      halftime: { away: 0, home: 7 },
      passTds: { away: 3, home: 2 }, rushTds: { away: 1, home: 2 },
      missedKick: true,
      // 4th quarter: DET led, then NO tied it 24-24. DET went ahead from the tie only in overtime.
      leadChange4q: false,
      fgs: 2, punts: 12, tds: 8, turnovers: 4, longestTd: 19, sacks: 6,
    });
  });
});

/** A summary built from scoring plays: [period, awayScore, homeScore, side, type, text]. */
function synthetic(plays: [number, number, number, 'away' | 'home', 'TD' | 'FG' | 'SF', string][], extra: { kicking?: [string, string]; passing?: [number, number] } = {}) {
  const team = (side: 'away' | 'home') => ({ id: side === 'away' ? '1' : '2', abbreviation: side === 'away' ? 'AWY' : 'HOM' });
  const last = plays[plays.length - 1];
  return {
    header: { competitions: [{ competitors: [
      { homeAway: 'away', score: String(last?.[1] ?? 0), team: team('away') },
      { homeAway: 'home', score: String(last?.[2] ?? 0), team: team('home') },
    ] }] },
    scoringPlays: plays.map(([period, a, h, side, type, text], i) => ({
      id: String(i + 1), period: { number: period }, awayScore: a, homeScore: h, team: team(side),
      scoringType: { abbreviation: type }, type: { text: type }, text,
    })),
    boxscore: {
      teams: [],
      players: (['away', 'home'] as const).map((side, i) => ({
        team: team(side),
        statistics: [
          { name: 'kicking', keys: ['fieldGoalsMade/fieldGoalAttempts', 'extraPointsMade/extraPointAttempts'], totals: [extra.kicking?.[i] ?? '0/0', '0/0'] },
          { name: 'passing', keys: ['passingTouchdowns'], totals: [String(extra.passing?.[i] ?? 0)] },
        ],
      })),
    },
  };
}

const LIVE = (period: number): FeedStatus => ({ state: 'in', period, clock: '5:00', name: 'STATUS_IN_PROGRESS' });

describe('4th-quarter lead change', () => {
  it('counts a team going ahead from behind', () => {
    const s = deriveGameStats(synthetic([[3, 7, 0, 'away', 'TD', 'A 5 Yd Run'], [4, 7, 10, 'home', 'TD', 'B 5 Yd Run']]), LIVE(4));
    expect(s.leadChange4q).toBe(true);
  });

  it('counts going from tied to ahead', () => {
    const s = deriveGameStats(synthetic([[3, 3, 3, 'away', 'FG', 'A 30 Yd Field Goal'], [4, 3, 6, 'home', 'FG', 'B 30 Yd Field Goal']]), LIVE(4));
    expect(s.leadChange4q).toBe(true);
  });

  it("doesn't count a team extending its lead, or tying the game", () => {
    expect(deriveGameStats(synthetic([[3, 7, 0, 'away', 'TD', 'A'], [4, 14, 0, 'away', 'TD', 'A']]), LIVE(4)).leadChange4q).toBe(false);
    expect(deriveGameStats(synthetic([[3, 7, 0, 'away', 'TD', 'A'], [4, 7, 7, 'home', 'TD', 'B']]), LIVE(4)).leadChange4q).toBe(false);
  });

  it("counts a game's first score coming in the 4th quarter (tied 0-0 to ahead)", () => {
    expect(deriveGameStats(synthetic([[4, 0, 3, 'home', 'FG', 'B 30 Yd Field Goal']]), LIVE(4)).leadChange4q).toBe(true);
  });

  it("doesn't count changes earlier in the game or in overtime", () => {
    const s = deriveGameStats(synthetic([[1, 7, 0, 'away', 'TD', 'A'], [2, 7, 10, 'home', 'TD', 'B'], [4, 10, 10, 'away', 'FG', 'A'], [5, 10, 13, 'home', 'FG', 'B']]), LIVE(5));
    expect(s.leadChange4q).toBe(false);
  });
});

describe('other derived stats', () => {
  it('a safety as the first score', () => {
    const s = deriveGameStats(synthetic([[1, 0, 2, 'home', 'SF', 'A Sacked by B for Safety']]), LIVE(1));
    expect(s.firstScore).toEqual({ side: 'home', type: 'safety' });
    expect(s.firstTd).toBeNull();
    expect(s.tds).toBe(0);
  });

  it('no touchdown in the game: longest TD is 0 and there is no first TD', () => {
    const s = deriveGameStats(synthetic([[1, 3, 0, 'away', 'FG', 'A 40 Yd Field Goal']]), { ...FINAL });
    expect(s.longestTd).toBe(0);
    expect(s.firstTd).toBeNull();
  });

  it('missed kicks include blocked ones (they count as attempts), not failed 2-point tries', () => {
    // A failed 2-point try isn't a kick, so it never shows in the kicking totals.
    expect(deriveGameStats(synthetic([], { kicking: ['1/2', '0/0'] }), LIVE(2)).missedKick).toBe(true);
    expect(deriveGameStats(synthetic([], { kicking: ['2/2', '1/1'] }), LIVE(2)).missedKick).toBe(false);
  });

  it('before halftime, the halftime score is the current score; after, it stays put', () => {
    const plays: Parameters<typeof synthetic>[0] = [[1, 7, 0, 'away', 'TD', 'A'], [3, 7, 3, 'home', 'FG', 'B']];
    expect(deriveGameStats(synthetic(plays.slice(0, 1)), LIVE(2))).toMatchObject({ halftimeReached: false, halftime: { away: 7, home: 0 } });
    expect(deriveGameStats(synthetic(plays), LIVE(3))).toMatchObject({ halftimeReached: true, halftime: { away: 7, home: 0 } });
    expect(deriveGameStats(synthetic(plays.slice(0, 1)), { ...LIVE(2), name: 'STATUS_HALFTIME' }).halftimeReached).toBe(true);
  });

  it('uses the scorer id when given, and parses the name from the play text', () => {
    expect(deriveGameStats(load('summary-mia-at-buf-2026-wk11.json'), FINAL, '3915416').firstTd?.scorerId).toBe('3915416');
    expect(scorerNameFromText('Amon-Ra St. Brown 19 Yd pass from Jared Goff (Jake Bates Kick)')).toBe('Amon-Ra St. Brown');
    expect(scorerNameFromText('T.J. Watt 35 Yd Interception Return (Chris Boswell Kick)')).toBe('T.J. Watt');
  });

  it('reads the scorer from a core-API play', () => {
    const play = { participants: [
      { type: 'passer', athlete: { $ref: 'http://x/athletes/3918298?lang=en' } },
      { type: 'scorer', athlete: { $ref: 'http://x/athletes/3915416?lang=en' } },
    ] };
    expect(scorerIdFromCorePlay(play)).toBe('3915416');
    expect(scorerIdFromCorePlay({})).toBeNull();
  });

  it('reads the feed status', () => {
    expect(feedStatus({ status: { period: 2, displayClock: '0:00', type: { state: 'in', name: 'STATUS_HALFTIME' } } }))
      .toEqual({ state: 'in', period: 2, clock: '0:00', name: 'STATUS_HALFTIME' });
    expect(feedStatus({}).state).toBe('pre');
  });

  it('a game that has not started has all zeros', () => {
    expect(preGameStats()).toMatchObject({ state: 'pre', away: 0, home: 0, tds: 0, firstScore: null });
  });
});
