// The page's game tabs and player picker (docs/thanksgiving-spec.md, "Page layout").
import { describe, expect, it } from 'vitest';
import { scoreGame } from '../../src/lib/thanksgiving/scoring';
import { preGameStats } from '../../src/lib/thanksgiving/stats';
import {
  CATEGORY_PICK_ROW,
  CATEGORY_SHORT,
  autoGameId,
  averageHint,
  categoryPicks,
  defaultPickerPlayer,
  gamePhase,
  pickerPlayers,
  lockedPoints,
  lockedPointsByGame,
  rankStandings,
  rowActual,
  rowLocked,
  splitTeams,
  rowLost,
  rowPoints,
  shortWorth,
  stepperDefault,
  teamLogo,
  whoCount,
  worthBadge,
  type Game,
} from '../../src/lib/thanksgiving/view';

const KICKOFF = Date.parse('2026-11-26T18:00:00Z');

describe('game phase', () => {
  it('is open before kickoff, live from kickoff until the game is final, then final', () => {
    expect(gamePhase(KICKOFF, null, KICKOFF - 1)).toBe('open');
    expect(gamePhase(KICKOFF, null, KICKOFF)).toBe('live'); // kicked off, even before the feed shows it started
    expect(gamePhase(KICKOFF, 'pre', KICKOFF + 1)).toBe('live');
    expect(gamePhase(KICKOFF, 'in', KICKOFF + 1)).toBe('live');
    expect(gamePhase(KICKOFF, 'post', KICKOFF + 1)).toBe('final');
  });

  it('a final-looking result before kickoff still leaves the game open (kickoff decides)', () => {
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
  it('returns the inline actual stat for a pick row', () => {
    const scoredCats = [
      { key: 'finalClosest', answer: 'CHI 10 – DET 14' },
      { key: 'punts', answer: '7' },
    ];
    expect(rowActual(scoredCats, 'final')).toBe('CHI 10 – DET 14');
    expect(rowActual(scoredCats, 'punts')).toBe('7');
    expect(rowActual(scoredCats, 'sacks')).toBeNull();
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
  it('every category has a short name and pick-row mapping', () => {
    const score = scoreGame({ ...preGameStats(), state: 'in', period: 1 }, [], { awayAbbr: 'CIN', homeAbbr: 'WSH', scorers: [] });
    expect(score.categories).toHaveLength(17);
    for (const c of score.categories) {
      expect(CATEGORY_SHORT[c.key], c.key).toMatch(/\S/);
      expect(CATEGORY_PICK_ROW[c.key], c.key).toMatch(/\S/);
    }
  });

  it("lists every family member's pick for a category, point-earners first, then you, then alphabetical", () => {
    const game: Game = {
      id: 'g1',
      order: 1,
      away: { id: '3', abbr: 'CHI', name: 'Chicago Bears', shortName: 'Bears', color: null },
      home: { id: '8', abbr: 'DET', name: 'Detroit Lions', shortName: 'Lions', color: null },
      tv: 'CBS',
      kickoff: KICKOFF,
      line: null,
      projection: null,
      scorers: [],
      averages: { away: null, home: null, nfl: null },
    };
    const players = [
      { id: 'a', name: 'Alice', hasPin: false },
      { id: 'b', name: 'Bob', hasPin: false },
      { id: 'c', name: 'Carol', hasPin: false },
    ];
    const picks = [
      { playerId: 'a', answers: { punts: 9, finalAway: 20, finalHome: 27 } },
      { playerId: 'b', answers: { punts: 7, finalAway: 17, finalHome: 24 } },
      { playerId: 'c', answers: { punts: 4 } },
      { playerId: 'removed', answers: { punts: 7 } },
    ];
    expect(categoryPicks(game, { key: 'punts', points: { b: 3 } }, picks, players, 'c')).toEqual([
      { playerId: 'b', name: 'Bob', isMe: false, pick: '7', points: 3 },
      { playerId: 'c', name: 'Carol', isMe: true, pick: '4', points: 0 },
      { playerId: 'a', name: 'Alice', isMe: false, pick: '9', points: 0 },
    ]);
    expect(categoryPicks(game, { key: 'finalClosest', points: { a: 3 } }, picks, players, null)).toEqual([
      { playerId: 'a', name: 'Alice', isMe: false, pick: 'CHI 20 – DET 27', points: 3 },
      { playerId: 'b', name: 'Bob', isMe: false, pick: 'CHI 17 – DET 24', points: 0 },
      { playerId: 'c', name: 'Carol', isMe: false, pick: '', points: 0 },
    ]);
    expect(categoryPicks(game, { key: 'punts', points: {} }, null, players, null)).toEqual([]);
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
  it('steppers start from the rounded NFL average (per game, or per team for longest TD), falling back to 0', () => {
    expect(stepperDefault('punts', nfl, 30)).toBe(8);
    expect(stepperDefault('fgs', nfl, 20)).toBe(4);
    expect(stepperDefault('longestTd', nfl, 109)).toBe(32);
    expect(stepperDefault('punts', null, 30)).toBe(0);
    expect(stepperDefault('fgs', { ...nfl, fgs: 15 }, 20)).toBe(20);
  });
});

describe("a player's picks: settled rows they lost are greyed out", () => {
  const cats: { key: string; status: string; points: Record<string, number> }[] = [
    { key: 'finalClosest', status: 'live', points: { a: 3 } },
    { key: 'finalWinner', status: 'live', points: { a: 1 } },
    { key: 'finalWithin15', status: 'live', points: {} },
    { key: 'firstTeam', status: 'final', points: { a: 1 } },
    { key: 'halftime', status: 'final', points: {} },
    { key: 'punts', status: 'live', points: {} },
  ];
  it('only once the row is final and the player got nothing from it', () => {
    expect(rowLost(cats, 'firstTeam', 'b')).toBe(true); // decided, b was wrong
    expect(rowLost(cats, 'firstTeam', 'a')).toBe(false); // decided, a was right
    expect(rowLost(cats, 'halftime', 'a')).toBe(true); // nobody was right
    expect(rowLost(cats, 'punts', 'a')).toBe(false); // still live
  });
  it('the final-score row is settled only when all three final-score categories are', () => {
    expect(rowLost(cats, 'final', 'b')).toBe(false);
    const ended = cats.map((c) => ({ ...c, status: 'final' }));
    expect(rowLost(ended, 'final', 'b')).toBe(true);
    expect(rowLost(ended, 'final', 'a')).toBe(false);
  });
  it('a row with no category behind it (or not scored yet) is never greyed', () => {
    expect(rowLost(cats, 'sacks', 'a')).toBe(false);
    expect(rowLost([], 'firstTeam', 'a')).toBe(false);
  });
});

describe('banked vs live points', () => {
  const cats: { key: string; status: string; points: Record<string, number> }[] = [
    { key: 'firstTeam', status: 'final', points: { a: 1 } },
    { key: 'punts', status: 'live', points: { b: 3 } },
    { key: 'finalClosest', status: 'live', points: { a: 3 } },
    { key: 'finalWinner', status: 'final', points: { a: 1 } },
    { key: 'finalWithin15', status: 'final', points: {} },
  ];
  it("a pick's points are banked only when every category behind it is final", () => {
    expect(rowLocked(cats, 'firstTeam')).toBe(true);
    expect(rowLocked(cats, 'punts')).toBe(false);
    expect(rowLocked(cats, 'final')).toBe(false); // one of the three final-score categories is still live
    expect(rowLocked(cats, 'sacks')).toBe(false); // not scored
  });

  it('banked points count final categories per game and across every game; live ones do not', () => {
    const results = {
      g1: { score: { categories: cats } },
      g2: { score: { categories: [{ key: 'sacks', status: 'final', points: { b: 3, a: 3 } }] } },
      g3: undefined,
    };
    expect(lockedPointsByGame(results)).toEqual({
      g1: { a: 2 },
      g2: { b: 3, a: 3 },
      g3: {},
    });
    expect(lockedPoints(results)).toEqual({ a: 5, b: 3 });
  });

  it('standings default to Live pace (then Banked), and can toggle to Banked (then Live); equal on both share a rank', () => {
    const rows = [
      { playerId: 'a', rank: 1, total: 12 },
      { playerId: 'b', rank: 2, total: 9 },
      { playerId: 'c', rank: 2, total: 9 },
      { playerId: 'd', rank: 4, total: 4 },
    ];
    const banked = { a: 2, b: 6, c: 6, d: 6 };
    // Default: Live pace first
    expect(rankStandings(rows, banked, false).map((r) => [r.playerId, r.rank, r.locked, r.live])).toEqual([
      ['a', 1, 2, 12],
      ['b', 2, 6, 9],
      ['c', 2, 6, 9],
      ['d', 4, 6, 4],
    ]);
    // Toggled: Banked first
    expect(rankStandings(rows, banked, false, 'banked').map((r) => [r.playerId, r.rank, r.locked, r.live])).toEqual([
      ['b', 1, 6, 9],
      ['c', 1, 6, 9],
      ['d', 3, 6, 4],
      ['a', 4, 2, 12],
    ]);
  });

  it('once every game is final, banked = live and the published order (with the tiebreaker) stands', () => {
    const rows = [
      { playerId: 'a', rank: 1, total: 9 },
      { playerId: 'b', rank: 2, total: 9 }, // lost the tiebreaker
    ];
    expect(rankStandings(rows, {}, true, 'banked')).toEqual([
      { playerId: 'a', rank: 1, locked: 9, live: 9 },
      { playerId: 'b', rank: 2, locked: 9, live: 9 },
    ]);
  });
});

describe('team logos in text (full-screen scoreboard)', () => {
  it('splits out whole-word team abbreviations', () => {
    expect(splitTeams('CIN 17 – WSH 19', ['CIN', 'WSH'])).toEqual([{ team: 'CIN' }, { text: ' 17 – ' }, { team: 'WSH' }, { text: ' 19' }]);
    expect(splitTeams('WSH ahead', ['CIN', 'WSH'])).toEqual([{ team: 'WSH' }, { text: ' ahead' }]);
    expect(splitTeams('CIN (2–0)', ['CIN', 'WSH'])).toEqual([{ team: 'CIN' }, { text: ' (2–0)' }]);
  });
  it('leaves other text alone, including abbreviations inside words', () => {
    expect(splitTeams('No (so far)', ['CIN', 'WSH'])).toEqual([{ text: 'No (so far)' }]);
    expect(splitTeams('Tee Higgins', ['CIN', 'WSH'])).toEqual([{ text: 'Tee Higgins' }]);
    expect(splitTeams('DALLAS', ['DAL'])).toEqual([{ text: 'DALLAS' }]);
    expect(splitTeams('', ['CIN'])).toEqual([]);
  });
});
