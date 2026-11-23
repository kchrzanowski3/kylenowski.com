// Recorded real games (docs/thanksgiving-spec.md, Testing §2). Expected numbers were read off each
// game's official box score (team stats, kicking, punting and the scoring summary), not computed by
// the code under test.
import { describe, expect, it } from 'vitest';
import { completedEventIds, deriveTeamGameStats, parseScoreboard, playYards } from '../../src/lib/thanksgiving/espn';
import { load } from './fixtures';

describe('parseScoreboard (Thanksgiving 2026)', () => {
  const games = parseScoreboard(load('scoreboard-2026-11-26.json'));

  it('finds the three Thursday games in kickoff order', () => {
    expect(games.map((g) => `${g.away.abbr}@${g.home.abbr}`)).toEqual(['CHI@DET', 'PHI@DAL', 'KC@BUF']);
  });

  it('reads kickoff times (1:00, 4:30 and 8:20 PM ET)', () => {
    expect(games.map((g) => new Date(g.kickoff).toISOString())).toEqual([
      '2026-11-26T18:00:00.000Z',
      '2026-11-26T21:30:00.000Z',
      '2026-11-27T01:20:00.000Z',
    ]);
  });

  it('reads TV, teams and the betting line', () => {
    expect(games[0].tv).toBe('CBS');
    expect(games[0].home).toMatchObject({ id: '8', abbr: 'DET', name: 'Detroit Lions', shortName: 'Lions' });
    expect(games[0].line).toEqual({ favorite: 'away', spread: 2.5, overUnder: 55.5, details: 'CHI -2.5' });
    expect(games[1].line).toEqual({ favorite: 'home', spread: 8.5, overUnder: 47.5, details: 'DAL -8.5' });
    expect(games[0].state).toBe('pre');
  });

  it('has no completed games yet', () => {
    expect(completedEventIds(load('scoreboard-2026-11-26.json'))).toEqual([]);
  });
});

describe('deriveTeamGameStats matches the box score', () => {
  it('MIA @ BUF, 2026 week 11 (9-26): field goals, no punts, sacks', () => {
    const s = deriveTeamGameStats(load('summary-mia-at-buf-2026-wk11.json'))!;
    expect(s.away).toEqual({ points: 9, fgs: 3, punts: 4, tds: 0, turnovers: 1, sacks: 3, longestTd: 0 });
    expect(s.home).toEqual({ points: 26, fgs: 4, punts: 0, tds: 2, turnovers: 2, sacks: 2, longestTd: 4 });
    expect([s.awayId, s.homeId]).toEqual(['15', '2']);
  });

  it('NO @ DET, 2026 week 1 (30-31 in overtime): overtime counts', () => {
    const s = deriveTeamGameStats(load('summary-no-at-det-2026-wk1-ot.json'))!;
    expect(s.away).toEqual({ points: 30, fgs: 1, punts: 5, tds: 4, turnovers: 3, sacks: 1, longestTd: 9 });
    expect(s.home).toEqual({ points: 31, fgs: 1, punts: 7, tds: 4, turnovers: 1, sacks: 5, longestTd: 19 });
  });

  it('NO @ CHI, 2026 week 11 (13-21): a safety is not a TD', () => {
    const s = deriveTeamGameStats(load('summary-no-at-chi-2026-wk11-safety.json'))!;
    expect(s.away).toEqual({ points: 13, fgs: 2, punts: 3, tds: 1, turnovers: 2, sacks: 2, longestTd: 1 });
    expect(s.home).toEqual({ points: 21, fgs: 2, punts: 3, tds: 2, turnovers: 2, sacks: 6, longestTd: 15 });
  });

  it('MIN @ TB, 2026 (23-16): a punt-return TD counts as a TD and as the longest TD', () => {
    const s = deriveTeamGameStats(load('summary-min-at-tb-2026-punt-return-td.json'))!;
    expect(s.away).toEqual({ points: 23, fgs: 3, punts: 8, tds: 2, turnovers: 1, sacks: 6, longestTd: 86 });
    expect(s.home).toEqual({ points: 16, fgs: 3, punts: 9, tds: 1, turnovers: 2, sacks: 3, longestTd: 40 });
  });
});

describe('playYards', () => {
  it('reads yards from scoring-play text', () => {
    expect(playYards('Myles Price 86 Yd Punt Return (Will Reichard Kick)')).toBe(86);
    expect(playYards('T.J. Watt 35 Yd Interception Return (Chris Boswell Kick)')).toBe(35);
    expect(playYards('James Cook III 1 Yd Rush (Tyler Bass Kick)')).toBe(1);
    expect(playYards('Fumble recovered in the end zone')).toBe(0);
  });
});
