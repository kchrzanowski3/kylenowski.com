// The page's game tabs and player picker (docs/thanksgiving-spec.md, "Page layout").
import { describe, expect, it } from 'vitest';
import { scoreGame } from '../../src/lib/thanksgiving/scoring';
import { preGameStats } from '../../src/lib/thanksgiving/stats';
import {
  CATEGORY_SHORT,
  autoGameId,
  averageHint,
  defaultPickerPlayer,
  gamePhase,
  pickerPlayers,
  rowPoints,
  shortWorth,
  teamLogo,
  whoCount,
  worthBadge,
} from '../../src/lib/thanksgiving/view';

const KICKOFF = Date.parse('2026-11-26T18:00:00Z');

describe('game phase (the lock icon)', () => {
  it('is open before kickoff, live from kickoff until the game is final, then final', () => {
    expect(gamePhase(KICKOFF, null, KICKOFF - 1)).toBe('open');
    expect(gamePhase(KICKOFF, null, KICKOFF)).toBe('live'); // locked, even before the feed shows it started
    expect(gamePhase(KICKOFF, 'pre', KICKOFF + 1)).toBe('live');
    expect(gamePhase(KICKOFF, 'in', KICKOFF + 1)).toBe('live');
    expect(gamePhase(KICKOFF, 'post', KICKOFF + 1)).toBe('final');
  });

  it('a final-looking result before kickoff still leaves the game open (the lock decides)', () => {
    expect(gamePhase(KICKOFF, 'post', KICKOFF - 1)).toBe('open');
  });
});

describe('the game the page opens on', () => {
  it('is the game being played', () => {
    expect(autoGameId([{ id: 'a', phase: 'final' }, { id: 'b', phase: 'live' }, { id: 'c', phase: 'open' }])).toBe('b');
  });
  it('else the next to kick off', () => {
    expect(autoGameId([{ id: 'a', phase: 'final' }, { id: 'b', phase: 'open' }, { id: 'c', phase: 'open' }])).toBe('b');
  });
  it('else the last game', () => {
    expect(autoGameId([{ id: 'a', phase: 'final' }, { id: 'b', phase: 'final' }])).toBe('b');
    expect(autoGameId([])).toBeNull();
  });
});

describe('player picker', () => {
  const cats: { key: string; points: Record<string, number> }[] = [
    { key: 'finalClosest', points: { a: 3 } },
    { key: 'finalWinner', points: { a: 1, b: 1 } },
    { key: 'finalWithin15', points: { a: 1 } },
    { key: 'punts', points: { b: 3 } },
  ];
  it("adds up a row's points; the final score row is the three final-score categories", () => {
    expect(rowPoints(cats, 'final', 'a')).toBe(5);
    expect(rowPoints(cats, 'final', 'b')).toBe(1);
    expect(rowPoints(cats, 'punts', 'b')).toBe(3);
    expect(rowPoints(cats, 'punts', 'a')).toBe(0);
    expect(rowPoints(cats, 'sacks', 'a')).toBe(0);
  });
  it('lists you first whenever you are signed in, even with no picks for the game', () => {
    expect(pickerPlayers(['a', 'b'], 'me')).toEqual(['me', 'a', 'b']);
    expect(pickerPlayers(['a', 'me', 'b'], 'me')).toEqual(['me', 'a', 'b']);
    expect(pickerPlayers(['a', 'b'], null)).toEqual(['a', 'b']);
  });
  it("starts on you; signed out, on the game's leader; else the first player", () => {
    expect(defaultPickerPlayer(['me', 'a', 'b'], 'me', { b: 9 })).toBe('me');
    expect(defaultPickerPlayer(['a', 'b'], null, { a: 2, b: 9 })).toBe('b');
    expect(defaultPickerPlayer(['a', 'b'], null, {})).toBe('a');
    expect(defaultPickerPlayer([], null)).toBeNull();
  });
});

describe('team logos', () => {
  it("come from ESPN's logo CDN, by abbreviation", () => {
    expect(teamLogo('WSH')).toBe('https://a.espncdn.com/i/teamlogos/nfl/500/wsh.png');
  });
});

describe("who's getting points", () => {
  it('every category has a short name', () => {
    const score = scoreGame({ ...preGameStats(), state: 'in', period: 1 }, [], { awayAbbr: 'CIN', homeAbbr: 'WSH', scorers: [] });
    expect(score.categories).toHaveLength(17);
    for (const c of score.categories) expect(CATEGORY_SHORT[c.key], c.key).toMatch(/\S/);
  });

  it('worth is numbers only, with pt/pts', () => {
    expect(shortWorth('3')).toBe('3');
    expect(shortWorth('1 each')).toBe('1');
    expect(shortWorth('1 (5 for safety)')).toBe('1/5');
    expect(worthBadge('3')).toBe('3 pts');
    expect(worthBadge('1 each')).toBe('1 pt');
    expect(worthBadge('1 (5 for safety)')).toBe('1/5 pts');
  });

  it("who's right is a count, with your name as You", () => {
    const names = new Map([['me', 'Kyle'], ['a', 'Ann'], ['b', 'Bob'], ['c', 'Cy']]);
    expect(whoCount([], names, 'me')).toBe('—');
    expect(whoCount(['a'], names, 'me')).toBe('Ann');
    expect(whoCount(['me'], names, 'me')).toBe('You');
    expect(whoCount(['a', 'me', 'b'], names, 'me')).toBe('You + 2');
    expect(whoCount(['a', 'b', 'c'], names, 'me')).toBe('3 players');
    expect(whoCount(['a', 'gone'], names, null)).toBe('Ann'); // removed players don't count
  });
});

describe('help shown while picking', () => {
  const nfl = { games: 300, points: 23.1, fgs: 1.9, punts: 4.05, tds: 2.6, turnovers: 1.2, sacks: 2.4, longestTd: 31.5 };
  it('number questions show the NFL average per game: twice the per-team average', () => {
    expect(averageHint('punts', nfl)).toBe('NFL average 8.1 per game');
    expect(averageHint('fgs', nfl)).toBe('NFL average 3.8 per game');
    expect(averageHint('sacks', nfl)).toBe('NFL average 4.8 per game');
  });
  it("the longest TD stays per team (a game's longest is the longer of the two, not their sum)", () => {
    expect(averageHint('longestTd', nfl)).toBe('NFL team average longest TD: 31.5 yards');
  });
  it('no averages, no hint', () => {
    expect(averageHint('punts', null)).toBeNull();
  });
});
