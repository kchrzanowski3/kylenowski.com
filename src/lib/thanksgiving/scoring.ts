// Scoring (docs/thanksgiving-spec.md, "Questions", "Scoring rules", "Standings", "Live scoring").
// Pure: game stats + picks → points. During a game every category is scored as if the game ended
// now ("live", i.e. projected); a category is "final" once its answer can't change any more.

import type { Answers } from './questions';
import type { GameStats } from './stats';
import type { ScorerOption, Side } from './types';

export type CategoryKey =
  | 'finalClosest' | 'finalWinner' | 'finalWithin15'
  | 'firstTeam' | 'firstScoreType' | 'firstTdScorer' | 'halftime' | 'passTds' | 'rushTds'
  | 'missedKick' | 'leadChange4q'
  | 'fgs' | 'punts' | 'tds' | 'turnovers' | 'longestTd' | 'sacks';

export type CategoryStatus = 'pre' | 'live' | 'final';

export interface CategoryResult {
  key: CategoryKey;
  label: string;
  worth: string;
  /** The answer so far, for display ("DET 24 – CHI 20", "Jahmyr Gibbs", "Yes", "7"). */
  answer: string;
  status: CategoryStatus;
  /** Points per player who scores in this category. */
  points: Record<string, number>;
}

export interface GameScore {
  status: 'pre' | 'live' | 'final';
  categories: CategoryResult[];
  /** Each player's points in this game (players with no points are left out). */
  totals: Record<string, number>;
  /** The game's winners (most points, ties are co-winners), once it's final. */
  winners: string[];
}

export interface PlayerPick {
  playerId: string;
  answers: Answers;
}

/** Fields an admin override may set (docs/thanksgiving-spec.md, "Admin"). */
export const OVERRIDABLE = [
  'state', 'away', 'home', 'firstScore', 'firstTd', 'halftimeReached', 'halftime', 'passTds', 'rushTds',
  'missedKick', 'leadChange4q', 'fgs', 'punts', 'tds', 'turnovers', 'longestTd', 'sacks',
] as const;
export type OverrideKey = (typeof OVERRIDABLE)[number];
export type Overrides = Partial<Pick<GameStats, OverrideKey>>;

/** An override wins over the live feed. */
export function applyOverrides(stats: GameStats, overrides: Overrides | null | undefined): GameStats {
  if (!overrides) return stats;
  const out = { ...stats } as Record<string, unknown>;
  for (const k of OVERRIDABLE) {
    if (overrides[k] !== undefined && overrides[k] !== null) out[k] = overrides[k];
  }
  return out as unknown as GameStats;
}

const leader = (a: number, h: number): Side | 'tie' => (a > h ? 'away' : h > a ? 'home' : 'tie');

/** Everyone whose guess is closest to the actual number gets `worth` (equal distances all win). */
function closest(entries: [string, number][], actual: number, worth: number): Record<string, number> {
  if (entries.length === 0) return {};
  const best = Math.min(...entries.map(([, v]) => Math.abs(v - actual)));
  return Object.fromEntries(entries.filter(([, v]) => Math.abs(v - actual) === best).map(([id]) => [id, worth]));
}

function matching(picks: PlayerPick[], get: (a: Answers) => unknown, actual: unknown, worth: number): Record<string, number> {
  return Object.fromEntries(picks.filter((p) => get(p.answers) !== undefined && get(p.answers) === actual).map((p) => [p.playerId, worth]));
}

/** The first-TD-scorer answer that wins: a listed player's id, 'other', or 'none' (no TD). */
export function firstTdAnswer(stats: GameStats, scorers: ScorerOption[]): string {
  if (!stats.firstTd) return 'none';
  const { scorerId, scorerName } = stats.firstTd;
  if (scorerId && scorers.some((s) => s.id === scorerId)) return scorerId;
  if (!scorerId) {
    const norm = (n: string) => n.toLowerCase().replace(/[^a-z]/g, '');
    const byName = scorers.find((s) => norm(s.name) === norm(scorerName));
    if (byName) return byName.id;
  }
  return 'other'; // anyone not on the list: backups, defense, special teams, linemen
}

export interface GameInfo {
  awayAbbr: string;
  homeAbbr: string;
  scorers: ScorerOption[];
}

export function scoreGame(stats: GameStats, picks: PlayerPick[], info: GameInfo): GameScore {
  const pre = stats.state === 'pre';
  const post = stats.state === 'post';
  const live = (finalNow: boolean): CategoryStatus => (pre ? 'pre' : post || finalNow ? 'final' : 'live');
  const sideText = (s: Side | 'tie') => (s === 'away' ? info.awayAbbr : s === 'home' ? info.homeAbbr : 'Tie');
  const cats: CategoryResult[] = [];
  const add = (c: Omit<CategoryResult, 'points'>, points: Record<string, number>) => cats.push({ ...c, points: pre ? {} : points });

  // 1. Final score.
  const finals = picks.filter((p) => p.answers.finalAway !== undefined && p.answers.finalHome !== undefined);
  const dist = (a: Answers) => Math.abs(a.finalAway! - stats.away) + Math.abs(a.finalHome! - stats.home);
  const scoreText = `${info.awayAbbr} ${stats.away} – ${info.homeAbbr} ${stats.home}`;
  add({ key: 'finalClosest', label: 'Final score: closest', worth: '3', answer: scoreText, status: live(false) },
    closest(finals.map((p) => [p.playerId, dist(p.answers)]), 0, 3));
  const winner = leader(stats.away, stats.home);
  add({ key: 'finalWinner', label: 'Final score: correct winner', worth: '1 each', answer: winner === 'tie' ? 'Tied' : `${sideText(winner)} ahead`, status: live(false) },
    winner === 'tie' ? {} : Object.fromEntries(finals.filter((p) => leader(p.answers.finalAway!, p.answers.finalHome!) === winner).map((p) => [p.playerId, 1])));
  add({ key: 'finalWithin15', label: 'Final score: within 15', worth: '1 each', answer: scoreText, status: live(false) },
    Object.fromEntries(finals.filter((p) => dist(p.answers) <= 15).map((p) => [p.playerId, 1])));

  // 2–3. First score.
  const fs = stats.firstScore;
  add({ key: 'firstTeam', label: 'First team to score', worth: '1', answer: fs ? sideText(fs.side) : 'No score yet', status: live(!!fs) },
    fs ? matching(picks, (a) => a.firstTeam, fs.side, 1) : {});
  const typeText = { td: 'TD', fg: 'FG', safety: 'Safety' } as const;
  add({ key: 'firstScoreType', label: 'How the first score was made', worth: '1 (5 for safety)', answer: fs ? typeText[fs.type] : 'No score yet', status: live(!!fs) },
    fs ? matching(picks, (a) => a.firstScoreType, fs.type, fs.type === 'safety' ? 5 : 1) : {});

  // 4. First TD scorer.
  const tdAnswer = firstTdAnswer(stats, info.scorers);
  const tdText = !stats.firstTd ? 'No TD yet' : tdAnswer === 'other' ? `Other player (${stats.firstTd.scorerName})` : (info.scorers.find((s) => s.id === tdAnswer)?.name ?? stats.firstTd.scorerName);
  add({ key: 'firstTdScorer', label: 'First TD scorer', worth: '3', answer: tdText, status: live(!!stats.firstTd) },
    matching(picks, (a) => a.firstTdScorer, tdAnswer, 3));

  // 5–7. Halftime leader, passing and rushing TDs.
  const half = leader(stats.halftime.away, stats.halftime.home);
  add({ key: 'halftime', label: 'Halftime leader', worth: '1', answer: half === 'tie' ? 'Tied' : sideText(half), status: live(stats.halftimeReached) },
    matching(picks, (a) => a.halftime, half, 1));
  const pass = leader(stats.passTds.away, stats.passTds.home);
  add({ key: 'passTds', label: 'More passing TDs', worth: '1', answer: `${sideText(pass)} (${stats.passTds.away}–${stats.passTds.home})`, status: live(false) },
    matching(picks, (a) => a.passTds, pass, 1));
  const rush = leader(stats.rushTds.away, stats.rushTds.home);
  add({ key: 'rushTds', label: 'More rushing TDs', worth: '1', answer: `${sideText(rush)} (${stats.rushTds.away}–${stats.rushTds.home})`, status: live(false) },
    matching(picks, (a) => a.rushTds, rush, 1));

  // 8–9. Yes/no: final as soon as "yes" happens (or overtime starts, for the 4th quarter).
  add({ key: 'missedKick', label: 'Missed XP or FG', worth: '1', answer: stats.missedKick ? 'Yes' : 'No (so far)', status: live(stats.missedKick) },
    matching(picks, (a) => a.missedKick, stats.missedKick, 1));
  add({ key: 'leadChange4q', label: '4th-quarter lead change', worth: '1', answer: stats.leadChange4q ? 'Yes' : 'No (so far)', status: live(stats.leadChange4q || stats.period > 4) },
    matching(picks, (a) => a.leadChange4q, stats.leadChange4q, 1));

  // 10–15. Closest numbers.
  const numbers: [CategoryKey & keyof Answers & keyof GameStats, string][] = [
    ['fgs', 'Total FGs made'], ['punts', 'Total punts'], ['tds', 'Total TDs'],
    ['turnovers', 'Combined turnovers'], ['longestTd', 'Longest TD yards'], ['sacks', 'Combined sacks'],
  ];
  for (const [key, label] of numbers) {
    const actual = stats[key] as number;
    const entries = picks.filter((p) => p.answers[key] !== undefined).map((p) => [p.playerId, p.answers[key] as number] as [string, number]);
    add({ key, label, worth: '3', answer: String(actual), status: live(false) }, closest(entries, actual, 3));
  }

  const totals: Record<string, number> = {};
  for (const c of cats) for (const [id, pts] of Object.entries(c.points)) totals[id] = (totals[id] ?? 0) + pts;
  const status = pre ? 'pre' : post ? 'final' : 'live';
  let winners: string[] = [];
  if (status === 'final' && Object.keys(totals).length > 0) {
    const best = Math.max(...Object.values(totals));
    winners = Object.keys(totals).filter((id) => totals[id] === best).sort();
  }
  return { status, categories: cats, totals, winners };
}

export interface ScoredGame {
  gameId: string;
  order: number;
  stats: GameStats;
  score: GameScore;
  picks: PlayerPick[];
}

export interface StandingRow {
  playerId: string;
  rank: number;
  total: number;
  byGame: Record<string, number>;
  /** Game-3 tiebreaker: |guessed total points − actual total points|, or null with no guess. */
  tiebreak: number | null;
}

export interface Standings {
  rows: StandingRow[];
  /** "final" once every game is final; "live" while any game is on; "pre" before any kickoff. */
  status: 'pre' | 'live' | 'final';
  /** Overall champion(s), once every game is final. */
  champions: string[];
}

/**
 * Overall standings: one running total across the games. Ties on total are broken by whose game-3
 * final-score guess (away + home) is closest to that game's actual total points; if that's still
 * tied (or the tied players made no game-3 guess), they share the rank: co-champions at the top.
 */
export function overallStandings(playerIds: string[], games: ScoredGame[]): Standings {
  const game3 = games.find((g) => g.order === 3) ?? [...games].sort((a, b) => b.order - a.order)[0];
  const tiebreak = (id: string): number | null => {
    const a = game3?.picks.find((p) => p.playerId === id)?.answers;
    if (!game3 || a?.finalAway === undefined || a?.finalHome === undefined) return null;
    return Math.abs(a.finalAway + a.finalHome - (game3.stats.away + game3.stats.home));
  };
  const rows: StandingRow[] = playerIds.map((id) => {
    const byGame: Record<string, number> = {};
    for (const g of games) byGame[g.gameId] = g.score.totals[id] ?? 0;
    return { playerId: id, rank: 0, total: Object.values(byGame).reduce((s, n) => s + n, 0), byGame, tiebreak: tiebreak(id) };
  });
  const tb = (r: StandingRow) => (r.tiebreak === null ? Infinity : r.tiebreak);
  rows.sort((a, b) => b.total - a.total || tb(a) - tb(b) || a.playerId.localeCompare(b.playerId));
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    r.rank = prev && prev.total === r.total && tb(prev) === tb(r) ? prev.rank : i + 1;
  });

  const statuses = games.map((g) => g.score.status);
  const status = statuses.length > 0 && statuses.every((s) => s === 'final') ? 'final' : statuses.some((s) => s !== 'pre') ? 'live' : 'pre';
  const champions = status === 'final' && rows.length > 0 ? rows.filter((r) => r.rank === 1).map((r) => r.playerId) : [];
  return { rows, status, champions };
}
