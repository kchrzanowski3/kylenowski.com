// Every scoring rule in docs/thanksgiving-spec.md ("Questions", "Scoring rules", "Standings",
// "Live scoring"), Testing §1.
import { describe, expect, it } from 'vitest';
import type { Answers } from '../../src/lib/thanksgiving/questions';
import {
  applyOverrides, firstTdAnswer, overallStandings, scoreGame,
  type CategoryKey, type GameScore, type PlayerPick, type ScoredGame,
} from '../../src/lib/thanksgiving/scoring';
import { deriveGameStats, preGameStats, type GameStats } from '../../src/lib/thanksgiving/stats';
import type { ScorerOption } from '../../src/lib/thanksgiving/types';
import { load } from './fixtures';

const SCORERS: ScorerOption[] = [
  { id: '101', name: 'Caleb Williams', pos: 'QB', side: 'away' },
  { id: '201', name: 'Jahmyr Gibbs', pos: 'RB', side: 'home' },
  { id: '202', name: 'Amon-Ra St. Brown', pos: 'WR', side: 'home' },
];
const INFO = { awayAbbr: 'CHI', homeAbbr: 'DET', scorers: SCORERS };

const stats = (over: Partial<GameStats> = {}): GameStats => ({
  ...preGameStats(),
  state: 'post', period: 4, halftimeReached: true,
  away: 20, home: 24, halftime: { away: 10, home: 14 },
  firstScore: { side: 'home', type: 'fg' },
  firstTd: { side: 'home', playId: '1', scorerId: '201', scorerName: 'Jahmyr Gibbs' },
  passTds: { away: 1, home: 2 }, rushTds: { away: 1, home: 1 },
  fgs: 4, punts: 8, tds: 5, turnovers: 2, longestTd: 45, sacks: 5,
  ...over,
});
const pick = (playerId: string, answers: Answers): PlayerPick => ({ playerId, answers });
const cat = (g: GameScore, key: CategoryKey) => g.categories.find((c) => c.key === key)!;

describe('final score', () => {
  it('closest by |away guess − away| + |home guess − home|: 3 points, ties all win', () => {
    const g = scoreGame(stats(), [
      pick('a', { finalAway: 21, finalHome: 24 }), // distance 1
      pick('b', { finalAway: 20, finalHome: 25 }), // distance 1
      pick('c', { finalAway: 17, finalHome: 24 }), // distance 3
    ], INFO);
    expect(cat(g, 'finalClosest').points).toEqual({ a: 3, b: 3 });
  });

  it('+1 to everyone with the winning team ahead', () => {
    const g = scoreGame(stats(), [pick('a', { finalAway: 10, finalHome: 40 }), pick('b', { finalAway: 30, finalHome: 7 })], INFO);
    expect(cat(g, 'finalWinner').points).toEqual({ a: 1 });
  });

  it('nobody gets the winner point when the game ends tied', () => {
    const g = scoreGame(stats({ away: 20, home: 20 }), [pick('a', { finalAway: 10, finalHome: 40 }), pick('b', { finalAway: 30, finalHome: 7 })], INFO);
    expect(cat(g, 'finalWinner').points).toEqual({});
  });

  it('+1 within 15: exactly 15 counts, 16 does not', () => {
    const g = scoreGame(stats({ away: 20, home: 24 }), [
      pick('a', { finalAway: 30, finalHome: 29 }), // 10 + 5 = 15
      pick('b', { finalAway: 30, finalHome: 30 }), // 10 + 6 = 16
    ], INFO);
    expect(cat(g, 'finalWithin15').points).toEqual({ a: 1 });
  });

  it('a skipped final score gets nothing for any of its three parts', () => {
    const g = scoreGame(stats(), [pick('a', { punts: 3 })], INFO);
    expect([cat(g, 'finalClosest').points, cat(g, 'finalWinner').points, cat(g, 'finalWithin15').points]).toEqual([{}, {}, {}]);
  });
});

describe('first score', () => {
  it('right team scores first: 1', () => {
    const g = scoreGame(stats(), [pick('a', { firstTeam: 'home' }), pick('b', { firstTeam: 'away' })], INFO);
    expect(cat(g, 'firstTeam').points).toEqual({ a: 1 });
  });

  it('TD or FG: 1 point; safety: 5 points', () => {
    expect(cat(scoreGame(stats(), [pick('a', { firstScoreType: 'fg' })], INFO), 'firstScoreType').points).toEqual({ a: 1 });
    expect(cat(scoreGame(stats({ firstScore: { side: 'away', type: 'td' } }), [pick('a', { firstScoreType: 'td' })], INFO), 'firstScoreType').points).toEqual({ a: 1 });
    expect(cat(scoreGame(stats({ firstScore: { side: 'away', type: 'safety' } }), [pick('a', { firstScoreType: 'safety' }), pick('b', { firstScoreType: 'td' })], INFO), 'firstScoreType').points).toEqual({ a: 5 });
  });

  it('nobody scores in a 0-0 game', () => {
    const g = scoreGame(stats({ away: 0, home: 0, firstScore: null, firstTd: null }), [pick('a', { firstTeam: 'home', firstScoreType: 'fg' })], INFO);
    expect(cat(g, 'firstTeam').points).toEqual({});
    expect(cat(g, 'firstScoreType').points).toEqual({});
  });
});

describe('first TD scorer (3 points)', () => {
  it('the listed player who scored wins', () => {
    const g = scoreGame(stats(), [pick('a', { firstTdScorer: '201' }), pick('b', { firstTdScorer: '202' }), pick('c', { firstTdScorer: 'other' })], INFO);
    expect(cat(g, 'firstTdScorer').points).toEqual({ a: 3 });
  });

  it('a listed player scoring on a return still counts as that player', () => {
    const s = stats({ firstTd: { side: 'home', playId: '1', scorerId: '202', scorerName: 'Amon-Ra St. Brown' } });
    expect(firstTdAnswer(s, SCORERS)).toBe('202');
  });

  it('anyone not on the list is "Other player" (defense, special teams, backups, linemen)', () => {
    const s = stats({ firstTd: { side: 'away', playId: '1', scorerId: '999', scorerName: 'Montez Sweat' } });
    const g = scoreGame(s, [pick('a', { firstTdScorer: 'other' }), pick('b', { firstTdScorer: '101' })], INFO);
    expect(cat(g, 'firstTdScorer').points).toEqual({ a: 3 });
  });

  it('"No TD" wins only when the game has no touchdown', () => {
    const none = scoreGame(stats({ firstTd: null, tds: 0, longestTd: 0 }), [pick('a', { firstTdScorer: 'none' }), pick('b', { firstTdScorer: 'other' })], INFO);
    expect(cat(none, 'firstTdScorer').points).toEqual({ a: 3 });
    expect(cat(scoreGame(stats(), [pick('a', { firstTdScorer: 'none' })], INFO), 'firstTdScorer').points).toEqual({});
  });

  it('a pick on a player dropped from the list stays but does not score, even if he scores', () => {
    const s = stats({ firstTd: { side: 'home', playId: '1', scorerId: '777', scorerName: 'Dropped Guy' } });
    const g = scoreGame(s, [pick('a', { firstTdScorer: '777' }), pick('b', { firstTdScorer: 'other' })], INFO);
    expect(cat(g, 'firstTdScorer').points).toEqual({ b: 3 });
  });

  it('matches by name when the scorer id is not known yet', () => {
    expect(firstTdAnswer(stats({ firstTd: { side: 'home', playId: '1', scorerId: null, scorerName: 'Jahmyr Gibbs' } }), SCORERS)).toBe('201');
    expect(firstTdAnswer(stats({ firstTd: { side: 'home', playId: '1', scorerId: null, scorerName: 'Someone Else' } }), SCORERS)).toBe('other');
  });
});

describe('team and yes/no questions (1 point each)', () => {
  it('halftime leader, including a tie at halftime', () => {
    expect(cat(scoreGame(stats(), [pick('a', { halftime: 'home' }), pick('b', { halftime: 'tie' })], INFO), 'halftime').points).toEqual({ a: 1 });
    expect(cat(scoreGame(stats({ halftime: { away: 7, home: 7 } }), [pick('a', { halftime: 'home' }), pick('b', { halftime: 'tie' })], INFO), 'halftime').points).toEqual({ b: 1 });
  });

  it('more passing / rushing TDs, with ties', () => {
    const g = scoreGame(stats(), [pick('a', { passTds: 'home', rushTds: 'tie' }), pick('b', { passTds: 'tie', rushTds: 'away' })], INFO);
    expect(cat(g, 'passTds').points).toEqual({ a: 1 });
    expect(cat(g, 'rushTds').points).toEqual({ a: 1 });
  });

  it('missed kick and 4th-quarter lead change', () => {
    const g = scoreGame(stats({ missedKick: true, leadChange4q: false }), [pick('a', { missedKick: true, leadChange4q: false }), pick('b', { missedKick: false, leadChange4q: true })], INFO);
    expect(cat(g, 'missedKick').points).toEqual({ a: 1 });
    expect(cat(g, 'leadChange4q').points).toEqual({ a: 1 });
  });
});

describe('closest numbers (3 points)', () => {
  it('only the closest guess scores; equally close guesses each get the full 3', () => {
    const g = scoreGame(stats({ punts: 8 }), [pick('a', { punts: 6 }), pick('b', { punts: 10 }), pick('c', { punts: 11 })], INFO);
    expect(cat(g, 'punts').points).toEqual({ a: 3, b: 3 });
  });

  it('everyone tied gets full points', () => {
    const g = scoreGame(stats({ sacks: 5 }), [pick('a', { sacks: 3 }), pick('b', { sacks: 3 }), pick('c', { sacks: 7 })], INFO);
    expect(cat(g, 'sacks').points).toEqual({ a: 3, b: 3, c: 3 });
  });

  it('longest TD is 0 in a game with no touchdown', () => {
    const g = scoreGame(stats({ firstTd: null, tds: 0, longestTd: 0 }), [pick('a', { longestTd: 0 }), pick('b', { longestTd: 20 })], INFO);
    expect(cat(g, 'longestTd').points).toEqual({ a: 3 });
  });

  it('a skipped question gets 0', () => {
    const g = scoreGame(stats(), [pick('a', {}), pick('b', { fgs: 20 })], INFO);
    expect(cat(g, 'fgs').points).toEqual({ b: 3 });
    expect(g.totals.a).toBeUndefined();
  });
});

describe('maximum score', () => {
  const perfect = (firstScoreType: 'fg' | 'safety'): Answers => ({
    finalAway: 20, finalHome: 24, firstTeam: 'home', firstScoreType, firstTdScorer: '201', halftime: 'home',
    passTds: 'home', rushTds: 'tie', missedKick: false, leadChange4q: false,
    fgs: 4, punts: 8, tds: 5, turnovers: 2, longestTd: 45, sacks: 5,
  });
  it('is 33, or 37 with a correct safety pick', () => {
    expect(scoreGame(stats(), [pick('a', perfect('fg'))], INFO).totals.a).toBe(33);
    expect(scoreGame(stats({ firstScore: { side: 'home', type: 'safety' } }), [pick('a', perfect('safety'))], INFO).totals.a).toBe(37);
  });
});

describe('live (projected) vs final', () => {
  const live = (over: Partial<GameStats>) => stats({ state: 'in', period: 2, halftimeReached: false, missedKick: false, leadChange4q: false, ...over });
  const statusOf = (s: GameStats) => Object.fromEntries(scoreGame(s, [], INFO).categories.map((c) => [c.key, c.status]));

  it('before kickoff nothing is scored', () => {
    const g = scoreGame(preGameStats(), [pick('a', { punts: 0, firstTdScorer: 'none' })], INFO);
    expect(g.status).toBe('pre');
    expect(g.totals).toEqual({});
    expect(g.categories.every((c) => c.status === 'pre')).toBe(true);
  });

  it('during the game, categories score as if it ended now and are marked live', () => {
    const g = scoreGame(live({ punts: 4 }), [pick('a', { punts: 4 })], INFO);
    expect(g.status).toBe('live');
    expect(cat(g, 'punts')).toMatchObject({ status: 'live', points: { a: 3 } });
  });

  it('first team / how first score / first TD scorer are final once they happen', () => {
    const before = statusOf(live({ firstScore: null, firstTd: null }));
    expect(before).toMatchObject({ firstTeam: 'live', firstScoreType: 'live', firstTdScorer: 'live' });
    const after = statusOf(live({}));
    expect(after).toMatchObject({ firstTeam: 'final', firstScoreType: 'final', firstTdScorer: 'final' });
  });

  it('"No TD" is the projected answer until the first TD', () => {
    const g = scoreGame(live({ firstTd: null }), [pick('a', { firstTdScorer: 'none' })], INFO);
    expect(cat(g, 'firstTdScorer')).toMatchObject({ status: 'live', points: { a: 3 } });
  });

  it('halftime leader is projected from the current score, and final at halftime', () => {
    const before = scoreGame(live({ away: 3, home: 0, halftime: { away: 3, home: 0 } }), [pick('a', { halftime: 'away' })], INFO);
    expect(cat(before, 'halftime')).toMatchObject({ status: 'live', points: { a: 1 } });
    expect(statusOf(live({ halftimeReached: true, period: 3 })).halftime).toBe('final');
  });

  it('missed kick / lead change are final once "yes" happens, otherwise at the end', () => {
    expect(statusOf(live({ missedKick: true, leadChange4q: true }))).toMatchObject({ missedKick: 'final', leadChange4q: 'final' });
    expect(statusOf(live({}))).toMatchObject({ missedKick: 'live', leadChange4q: 'live' });
    expect(statusOf(live({ period: 5 })).leadChange4q).toBe('final'); // overtime: the 4th quarter is over
    expect(statusOf(stats())).toMatchObject({ missedKick: 'final', leadChange4q: 'final' });
  });

  it('final score and number questions are live until the game ends', () => {
    expect(statusOf(live({}))).toMatchObject({ finalClosest: 'live', finalWinner: 'live', punts: 'live', sacks: 'live' });
    expect(Object.values(statusOf(stats())).every((s) => s === 'final')).toBe(true);
  });
});

describe('game winner', () => {
  it('is whoever has the most points once the game is final; ties are co-winners', () => {
    const picks = [pick('a', { punts: 8 }), pick('b', { punts: 8 }), pick('c', { punts: 2 })];
    expect(scoreGame(stats(), picks, INFO).winners).toEqual(['a', 'b']);
    expect(scoreGame(stats({ state: 'in' }), picks, INFO).winners).toEqual([]);
  });
});

describe('admin overrides', () => {
  it('win over the feed', () => {
    const s = applyOverrides(stats({ punts: 8 }), { punts: 9, missedKick: true });
    expect(s).toMatchObject({ punts: 9, missedKick: true, sacks: 5 });
    expect(applyOverrides(stats(), null).punts).toBe(8);
  });
});

describe('overall standings', () => {
  const game = (order: number, st: GameStats, picks: PlayerPick[]): ScoredGame => ({ gameId: `g${order}`, order, stats: st, picks, score: scoreGame(st, picks, INFO) });
  // Game 3 in these tests ends CHI 20 – DET 24: 44 total points.
  const both8 = game(1, stats({ punts: 8 }), [pick('a', { punts: 8 }), pick('b', { punts: 8 })]); // 3 points each

  it('is one running total across the games, with points per game', () => {
    const s = overallStandings(['a', 'b'], [
      game(1, stats({ punts: 8 }), [pick('a', { punts: 8 }), pick('b', { punts: 1 })]),
      game(2, stats({ sacks: 5 }), [pick('b', { sacks: 5 })]),
    ]);
    expect(s.rows.map((r) => [r.playerId, r.total, r.byGame])).toEqual([
      ['a', 3, { g1: 3, g2: 0 }],
      ['b', 3, { g1: 0, g2: 3 }],
    ]);
  });

  it('a player who skips a whole game can still win', () => {
    // a skips game 1 (b's lone punts guess is closest: 3). In game 2, a gets punts and sacks (6).
    const s = overallStandings(['a', 'b'], [
      game(1, stats({ punts: 8 }), [pick('b', { punts: 1 })]),
      game(2, stats({ punts: 8, sacks: 5 }), [pick('a', { punts: 8, sacks: 5 }), pick('b', { punts: 1 })]),
      game(3, stats(), []),
    ]);
    expect(s.rows.map((r) => [r.playerId, r.total])).toEqual([['a', 6], ['b', 3]]);
    expect(s.champions).toEqual(['a']);
  });

  it('breaks a tie by whose game-3 total points (away + home guess) is closest', () => {
    // a guesses 16-28 (44 total, exact); b guesses 24-28 (52, off by 8). Both are distance 8 from
    // 20-24, have DET winning and are within 15, so they score the same.
    const g3 = game(3, stats(), [pick('a', { finalAway: 16, finalHome: 28 }), pick('b', { finalAway: 24, finalHome: 28 })]);
    const s = overallStandings(['a', 'b'], [both8, g3]);
    expect(s.rows[0].total).toBe(s.rows[1].total);
    expect(s.rows[0]).toMatchObject({ playerId: 'a', tiebreak: 0, rank: 1 });
    expect(s.rows[1]).toMatchObject({ playerId: 'b', tiebreak: 8, rank: 2 });
    expect(s.champions).toEqual(['a']);
  });

  it('co-champions when the tiebreaker is tied too', () => {
    const g3 = game(3, stats(), [pick('a', { finalAway: 16, finalHome: 28 }), pick('b', { finalAway: 16, finalHome: 28 })]);
    const s = overallStandings(['a', 'b'], [both8, g3]);
    expect(s.rows.map((r) => r.rank)).toEqual([1, 1]);
    expect(s.champions).toEqual(['a', 'b']);
  });

  it("co-champions when the tied players didn't pick game 3's final score", () => {
    const s = overallStandings(['a', 'b'], [both8, game(3, stats(), [])]);
    expect(s.rows.map((r) => [r.rank, r.tiebreak])).toEqual([[1, null], [1, null]]);
    expect(s.champions).toEqual(['a', 'b']);
  });

  it('the tiebreaker is the last game: game 2 of a two-game contest (the test contest)', () => {
    // Same guesses as above, on game 2 of 2: a is exact (44), b is off by 8. A game-1 guess doesn't count.
    const g1 = game(1, stats({ punts: 8 }), [pick('a', { punts: 8, finalAway: 24, finalHome: 28 }), pick('b', { punts: 8, finalAway: 16, finalHome: 28 })]);
    const g2 = game(2, stats(), [pick('a', { finalAway: 16, finalHome: 28 }), pick('b', { finalAway: 24, finalHome: 28 })]);
    const s = overallStandings(['a', 'b'], [g1, g2]);
    expect(s.rows[0].total).toBe(s.rows[1].total);
    expect(s.rows.map((r) => [r.playerId, r.tiebreak, r.rank])).toEqual([['a', 0, 1], ['b', 8, 2]]);
    expect(s.champions).toEqual(['a']);
  });

  it('a game-3 guess beats no guess in the tiebreaker', () => {
    // b's 52-point guess is off by 8 (and scores 3 + 1 + 1); a gets the same 5 from game 1 instead.
    const g1 = game(1, stats({ punts: 8, sacks: 5, missedKick: false }), [pick('a', { punts: 8, missedKick: false, firstTeam: 'home' })]);
    const g3 = game(3, stats(), [pick('b', { finalAway: 24, finalHome: 28 })]);
    const s = overallStandings(['a', 'b'], [g1, g3]);
    expect(s.rows.map((r) => [r.playerId, r.total])).toEqual([['b', 5], ['a', 5]]);
  });

  it('while games are on, standings are live (projected) and there is no champion yet', () => {
    const s = overallStandings(['a', 'b'], [both8, game(3, stats({ state: 'in' }), [])]);
    expect(s.status).toBe('live');
    expect(s.champions).toEqual([]);
    expect(overallStandings(['a'], [game(1, preGameStats(), [])]).status).toBe('pre');
  });
});

describe('a recorded game scored end to end', () => {
  it('NO @ CHI with hand-worked picks', () => {
    const s = deriveGameStats(load('summary-no-at-chi-2026-wk11-safety.json'), { state: 'post', period: 4, clock: '0:00', name: 'STATUS_FINAL' });
    const scorers: ScorerOption[] = [{ id: '4259545', name: "D'Andre Swift", pos: 'RB', side: 'home' }];
    const info = { awayAbbr: 'NO', homeAbbr: 'CHI', scorers };
    const picks = [
      // 13-21 final. Ann: 10-24 (distance 6), CHI wins, within 15; CHI first (FG): +1 +1; Swift: +3;
      // halftime CHI: +1; more passing TDs CHI (1-2): +1; missed kick yes: +1; punts 6 exact: +3.
      pick('ann', { finalAway: 10, finalHome: 24, firstTeam: 'home', firstScoreType: 'fg', firstTdScorer: '4259545', halftime: 'home', passTds: 'home', missedKick: true, punts: 6 }),
      // Bob: 17-14 (distance 4+7 = 11): closest beats Ann's 6? No: 11 > 6. Wrong winner, within 15: +1.
      // Safety pick: wrong. Punts 5 (off by 1): not closest.
      pick('bob', { finalAway: 17, finalHome: 14, firstScoreType: 'safety', punts: 5 }),
    ];
    const g = scoreGame(s, picks, info);
    expect(g.totals).toEqual({ ann: 3 + 1 + 1 + 1 + 1 + 3 + 1 + 1 + 1 + 3, bob: 1 });
    expect(g.winners).toEqual(['ann']);
  });
});
