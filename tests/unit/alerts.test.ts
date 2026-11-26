import { describe, expect, it } from 'vitest';
import {
  buildDemoAlerts,
  detectStandingsChange,
  diffGameAlert,
  diffSnapshotAlerts,
  formatAlertNames,
  improvedRankIds,
  toMobileAlert,
  type ResultSnapshot,
} from '../../src/lib/thanksgiving/alerts';
import { overallStandings, scoreGame, type GameInfo, type PlayerPick } from '../../src/lib/thanksgiving/scoring';
import { preGameStats, type GameStats } from '../../src/lib/thanksgiving/stats';
import { alertChimeKind } from '../../src/lib/thanksgiving/sound';
import type { Game, Player } from '../../src/lib/thanksgiving/view';

const GAME: Pick<Game, 'id' | 'away' | 'home'> = {
  id: 'g1',
  away: { id: '1', abbr: 'CHI', name: 'Chicago Bears', shortName: 'Bears', color: null },
  home: { id: '2', abbr: 'DET', name: 'Detroit Lions', shortName: 'Lions', color: null },
};

const INFO: GameInfo = {
  awayAbbr: 'CHI',
  homeAbbr: 'DET',
  scorers: [
    { id: '101', name: 'Jahmyr Gibbs', pos: 'RB', side: 'home' },
    { id: '102', name: 'Amon-Ra St. Brown', pos: 'WR', side: 'home' },
  ],
};

const PLAYERS: Player[] = [
  { id: 'kyle', name: 'Kyle', hasPin: false },
  { id: 'sarah', name: 'Sarah', hasPin: false },
  { id: 'mom', name: 'Mom', hasPin: false },
  { id: 'dad', name: 'Dad', hasPin: false },
];

const NAMES = new Map(PLAYERS.map((p) => [p.id, p.name]));

const PICKS: PlayerPick[] = [
  {
    playerId: 'kyle',
    answers: {
      finalAway: 17,
      finalHome: 24,
      firstTeam: 'home',
      firstScoreType: 'td',
      firstTdScorer: '101',
      halftime: 'home',
      passTds: 'home',
      rushTds: 'home',
      missedKick: true,
      leadChange4q: false,
      fgs: 3,
      punts: 6,
      tds: 5,
      turnovers: 3,
      longestTd: 30,
      sacks: 5,
    },
  },
  {
    playerId: 'sarah',
    answers: {
      finalAway: 20,
      finalHome: 17,
      firstTeam: 'away',
      firstScoreType: 'fg',
      firstTdScorer: '102',
      halftime: 'away',
      passTds: 'away',
      rushTds: 'tie',
      missedKick: false,
      leadChange4q: true,
      fgs: 5,
      punts: 8,
      tds: 4,
      turnovers: 1,
      longestTd: 18,
      sacks: 4,
    },
  },
  {
    playerId: 'mom',
    answers: {
      finalAway: 10,
      finalHome: 14,
      firstTeam: 'home',
      firstScoreType: 'td',
      firstTdScorer: '101',
      halftime: 'home',
      punts: 4,
      tds: 1,
      turnovers: 2,
      longestTd: 5,
      sacks: 2,
    },
  },
];

function snap(over: Partial<GameStats>): ResultSnapshot {
  const stats: GameStats = { ...preGameStats(), state: 'in', period: 1, clock: '10:00', ...over };
  return { stats, score: scoreGame(stats, PICKS, INFO) };
}

function standingsFor(s: ResultSnapshot) {
  return overallStandings(
    PLAYERS.map((p) => p.id),
    [{ gameId: GAME.id, order: 1, stats: s.stats, score: s.score, picks: PICKS }],
  );
}

describe('diffGameAlert', () => {
  it('emits nothing on initial load, clock-only ticks, or 0-0 kickoff', () => {
    const pre = snap({ state: 'pre', period: 0, clock: null });
    const kickoff = snap({ state: 'in', period: 1, clock: '15:00' });
    const clockTick = snap({ state: 'in', period: 1, clock: '14:10' });

    expect(diffGameAlert({ game: GAME, prev: undefined, next: kickoff, at: 1 })).toBeNull();
    expect(diffGameAlert({ game: GAME, prev: pre, next: kickoff, at: 2 })).toBeNull();
    expect(diffGameAlert({ game: GAME, prev: kickoff, next: clockTick, at: 3 })).toBeNull();
  });

  it('bundles First TD locks and live swings into one alert using ESPN lastScoringPlay text', () => {
    const before = snap({ period: 1, clock: '11:00' });
    const after = snap({
      period: 1,
      clock: '9:14',
      home: 7,
      tds: 1,
      rushTds: { away: 0, home: 1 },
      longestTd: 18,
      firstScore: { side: 'home', type: 'td' },
      firstTd: { side: 'home', playId: 'p1', scorerId: '101', scorerName: 'Jahmyr Gibbs' },
      lastScoringPlay: { id: 'p1', side: 'home', type: 'td', text: 'Jahmyr Gibbs 18 Yd Rush' },
    });

    const alert = diffGameAlert({ game: GAME, prev: before, next: after, at: 100 });
    expect(alert).not.toBeNull();
    expect(alert!.kind).toBe('banked');
    expect(alert!.tag).toBe('FIRST TD');
    expect(alert!.headline).toBe('DET TD · Jahmyr Gibbs 18 Yd Rush');
    expect(alert!.showOnTvBanner).toBe(true);

    // Banked items are sorted highest points first (First TD scorer 3 pts before 1-pt firsts).
    expect(alert!.banked.map((b) => b.categoryKey)).toEqual(['firstTdScorer', 'firstTeam', 'firstScoreType']);
    expect(alert!.banked[0].winners).toEqual(['kyle', 'mom']);

    // Live swings are bundled in the same alert, not emitted separately.
    expect(alert!.leading.length).toBeGreaterThan(0);
    expect(alert!.flashedCategories.some((f) => f.key === 'firstTdScorer' && f.tone === 'final')).toBe(true);
    expect(alert!.flashedCategories.some((f) => f.key === 'longestTd' && f.tone === 'live')).toBe(true);
  });

  it('collapses game end into a single Game Final alert instead of 10+ category lock notifications', () => {
    const lateQ4 = snap({
      period: 4,
      clock: '0:05',
      away: 17,
      home: 24,
      halftimeReached: true,
      halftime: { away: 7, home: 14 },
      firstScore: { side: 'home', type: 'td' },
      firstTd: { side: 'home', playId: 'p1', scorerId: '101', scorerName: 'Jahmyr Gibbs' },
      tds: 5,
      fgs: 3,
      punts: 6,
      turnovers: 3,
      longestTd: 30,
      sacks: 5,
    });
    const finalSnap = snap({
      ...lateQ4.stats,
      state: 'post',
      clock: '0:00',
    });

    const alerts = diffSnapshotAlerts({
      games: [GAME],
      prevResults: { g1: lateQ4 },
      nextResults: { g1: finalSnap },
      prevStandings: standingsFor(lateQ4),
      nextStandings: standingsFor(finalSnap),
      players: PLAYERS,
      at: 500,
    });

    expect(alerts).toHaveLength(1);
    const alert = alerts[0];
    expect(alert.kind).toBe('final');
    expect(alert.tag).toBe('FINAL');
    expect(alert.headline).toBe('CHI 17 – DET 24');
    // Individual banked items are suppressed on Game Final.
    expect(alert.banked).toEqual([]);
    expect(alert.leading).toEqual([]);
    expect(alert.gameWinners?.playerIds).toEqual(['kyle']);
    expect(alert.standingsLead?.isChampion).toBe(true);
    expect(alert.standingsLead?.newLeaders).toEqual(['kyle']);
    // Remaining live categories still flash green once in the TV table.
    expect(alert.flashedCategories.length).toBeGreaterThan(8);
    expect(alert.flashedCategories.every((f) => f.tone === 'final')).toBe(true);
  });

  it('triggers TV banner on turnovers and 3-pt closest-stat lead changes (e.g. punts, sacks)', () => {
    const before = snap({ punts: 4, turnovers: 1 });
    const afterPunt = snap({ punts: 6, turnovers: 1 });
    const puntAlert = diffGameAlert({ game: GAME, prev: before, next: afterPunt, at: 200 });
    expect(puntAlert).not.toBeNull();
    expect(puntAlert!.tag).toBe('PUNT');
    expect(puntAlert!.showOnTvBanner).toBe(true);
    expect(puntAlert!.leading.some((i) => i.categoryKey === 'punts' && i.winners.includes('kyle'))).toBe(true);

    const afterTurnover = snap({ punts: 4, turnovers: 2 });
    const toAlert = diffGameAlert({ game: GAME, prev: before, next: afterTurnover, at: 201 });
    expect(toAlert).not.toBeNull();
    expect(toAlert!.tag).toBe('TURNOVER');
    expect(toAlert!.showOnTvBanner).toBe(true);
  });

  it('triggers row-flash only (no TV banner) on a 1-pt live-only flip with no scoring play or turnover', () => {
    // Admin correction on rushTds only (1-pt live category, no score/turnover change).
    const before = snap({ rushTds: { away: 0, home: 0 } });
    const after = snap({ rushTds: { away: 0, home: 1 } });
    const alert = diffGameAlert({ game: GAME, prev: before, next: after, at: 250 });
    expect(alert).not.toBeNull();
    expect(alert!.showOnTvBanner).toBe(false);
    expect(alert!.flashedCategories).toEqual([{ key: 'rushTds', tone: 'live' }]);
  });

  it('handles mid-game milestones: halftime and missed kick', () => {
    const q2 = snap({ period: 2, clock: '0:02', away: 7, home: 14, halftime: { away: 7, home: 14 }, halftimeReached: false });
    const ht = snap({ ...q2.stats, clock: '0:00', halftimeReached: true });
    const htAlert = diffGameAlert({ game: GAME, prev: q2, next: ht, at: 300 });
    expect(htAlert?.tag).toBe('HALFTIME');
    expect(htAlert?.banked.map((b) => b.categoryKey)).toEqual(['halftime']);
    expect(htAlert?.showOnTvBanner).toBe(true);

    const afterMiss = snap({ ...ht.stats, period: 3, clock: '8:00', missedKick: true });
    const missAlert = diffGameAlert({ game: GAME, prev: ht, next: afterMiss, at: 301 });
    expect(missAlert?.tag).toBe('MISSED KICK');
    expect(missAlert?.banked.map((b) => b.categoryKey)).toEqual(['missedKick']);
    expect(missAlert?.showOnTvBanner).toBe(true);
  });
});

describe('toMobileAlert & standings changes', () => {
  it('notifies signed-in player when they bank points or newly take a lead, and ignores unaffected players', () => {
    const before = snap({ period: 1, clock: '11:00' });
    const after = snap({
      period: 1,
      clock: '9:14',
      home: 7,
      tds: 1,
      rushTds: { away: 0, home: 1 },
      longestTd: 18,
      firstScore: { side: 'home', type: 'td' },
      firstTd: { side: 'home', playId: 'p1', scorerId: '101', scorerName: 'Jahmyr Gibbs' },
      lastScoringPlay: { id: 'p1', side: 'home', type: 'td', text: 'Jahmyr Gibbs 18 Yd Rush' },
    });

    const alert = diffGameAlert({ game: GAME, prev: before, next: after, at: 400 })!;

    // Kyle banked First TD scorer (+3), First to score (+1), First score type (+1).
    const kyleAlert = toMobileAlert({ alert, meId: 'kyle', nextResult: after });
    expect(kyleAlert).not.toBeNull();
    expect(kyleAlert!.tone).toBe('banked');
    expect(kyleAlert!.badge).toBe('+5 banked');
    expect(kyleAlert!.impact).toContain('You banked First TD scorer (+3)');

    // Sarah didn't bank anything on this play, but moved into the lead on Longest TD (picked 18).
    const sarahAlert = toMobileAlert({ alert, meId: 'sarah', nextResult: after });
    expect(sarahAlert).not.toBeNull();
    expect(sarahAlert!.tone).toBe('live');
    expect(sarahAlert!.impact).toContain('Longest TD (+3)');

    // Dad made no picks, so he gets nothing (no spam).
    expect(toMobileAlert({ alert, meId: 'dad', nextResult: after })).toBeNull();
    // Signed out gets nothing.
    expect(toMobileAlert({ alert, meId: null, nextResult: after })).toBeNull();
  });

  it('detects overall 1st-place changes and rank improvements', () => {
    const s1 = snap({ away: 17, home: 10, fgs: 5, punts: 8 });
    const s2 = snap({ away: 17, home: 24, fgs: 3, punts: 6, tds: 5, turnovers: 3, sacks: 5, longestTd: 30 });
    const st1 = standingsFor(s1);
    const st2 = standingsFor(s2);
    const known = new Set(PLAYERS.map((p) => p.id));

    const lead = detectStandingsChange(st1, st2, { g1: s1 }, { g1: s2 }, known);
    expect(lead?.newLeaders).toEqual(['kyle']);
    expect(lead?.isChampion).toBe(false);
    expect(improvedRankIds(st1, st2, { g1: s1 }, { g1: s2 }, known)).toContain('kyle');
  });

  it('formats names compactly and builds 4 demo alerts', () => {
    expect(formatAlertNames([], NAMES)).toBe('No one');
    expect(formatAlertNames(['kyle'], NAMES)).toBe('Kyle');
    expect(formatAlertNames(['kyle', 'sarah'], NAMES)).toBe('Kyle & Sarah');
    expect(formatAlertNames(['kyle', 'sarah', 'mom', 'dad'], NAMES)).toBe('Kyle, Sarah + 2');

    const demos = buildDemoAlerts({ game: GAME, players: PLAYERS, meId: 'kyle', at: 1000 });
    expect(demos).toHaveLength(4);
    expect(demos.map((d) => d.label)).toEqual(['First TD', 'Big Swing', 'Halftime', 'Game Final']);
    expect(demos[3].tvAlert.kind).toBe('final');
    expect(demos[3].tvAlert.banked).toEqual([]);
  });

  it('maps every TV alert type to its matching broadcast sound cue', () => {
    expect(alertChimeKind({ kind: 'final', banked: [] })).toBe('final');
    expect(alertChimeKind({ kind: 'banked', banked: [{}] })).toBe('banked');
    expect(alertChimeKind({ kind: 'scoring', banked: [{}] })).toBe('banked');
    expect(alertChimeKind({ kind: 'scoring', banked: [] })).toBe('scoring');
    expect(alertChimeKind({ kind: 'swing', banked: [] })).toBe('swing');
  });
});
