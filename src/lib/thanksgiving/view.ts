// Game data as the page sees it, plus display helpers shared by the components.

import type { Answers } from './questions';
import type { CategoryKey } from './scoring';
import type { Line, Projection, ScorerOption, Side, TeamAverages, TeamInfo } from './types';

export interface Game {
  id: string;
  order: number;
  away: TeamInfo;
  home: TeamInfo;
  tv: string | null;
  kickoff: number; // epoch ms (lock time)
  line: Line | null;
  projection: Projection | null;
  scorers: ScorerOption[];
  averages: { away: TeamAverages | null; home: TeamAverages | null; nfl: TeamAverages | null };
}

export interface Player {
  id: string;
  name: string;
  hasPin: boolean;
}

export interface Pick {
  playerId: string;
  answers: Answers;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function toGame(id: string, d: any): Game | null {
  if (!d?.kickoff || !d.away || !d.home) return null;
  return {
    id,
    order: d.order ?? 0,
    away: d.away,
    home: d.home,
    tv: d.tv ?? null,
    kickoff: d.kickoff.toMillis(),
    line: d.line ?? null,
    projection: d.projection ?? null,
    scorers: Array.isArray(d.scorers) ? d.scorers : [],
    averages: { away: d.averages?.away ?? null, home: d.averages?.home ?? null, nfl: d.averages?.nfl ?? null },
  };
}

export function teamFor(game: Game, side: Side): TeamInfo {
  return game[side];
}

/** "2h 14m", "5m 03s", "40s". */
export function countdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

/** How an answer reads in the revealed-picks table. */
export function answerText(game: Game, key: keyof Answers | 'final', a: Answers): string {
  const side = (v: string | undefined) => (v === 'away' ? game.away.abbr : v === 'home' ? game.home.abbr : v === 'tie' ? 'Tie' : '');
  switch (key) {
    case 'final':
      return a.finalAway !== undefined && a.finalHome !== undefined
        ? `${game.away.abbr} ${a.finalAway} – ${game.home.abbr} ${a.finalHome}`
        : '';
    case 'firstTeam':
    case 'halftime':
    case 'passTds':
    case 'rushTds':
      return side(a[key]);
    case 'firstScoreType':
      return a.firstScoreType ? { td: 'TD', fg: 'FG', safety: 'Safety' }[a.firstScoreType] : '';
    case 'firstTdScorer': {
      const v = a.firstTdScorer;
      if (!v) return '';
      if (v === 'other') return 'Other player';
      if (v === 'none') return 'No TD';
      const p = game.scorers.find((s) => s.id === v);
      return p ? p.name : 'Player no longer listed';
    }
    case 'missedKick':
    case 'leadChange4q':
      return a[key] === undefined ? '' : a[key] ? 'Yes' : 'No';
    default: {
      const v = a[key as keyof Answers];
      return v === undefined ? '' : String(v);
    }
  }
}

// --- Game tabs and the player picker (docs/thanksgiving-spec.md, "Page layout") ---------------

/** Where a game is: open for picks, locked and being played (live), or over (final). */
export type GamePhase = 'open' | 'live' | 'final';

/** A game's phase from its lock time and its published result's state ('pre' | 'in' | 'post'). */
export function gamePhase(kickoff: number, resultState: string | null | undefined, now: number): GamePhase {
  if (now < kickoff) return 'open';
  return resultState === 'post' ? 'final' : 'live';
}

/** The game the page opens on: the one being played, else the next to kick off, else the last. */
export function autoGameId(games: { id: string; phase: GamePhase }[]): string | null {
  return (games.find((g) => g.phase === 'live') ?? games.find((g) => g.phase === 'open') ?? games[games.length - 1])?.id ?? null;
}

/** ESPN's logo for a team, by its abbreviation (CIN, WSH, ...). */
export function teamLogo(abbr: string): string {
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${encodeURIComponent(abbr.toLowerCase())}.png`;
}

/** The scoring categories behind each row of a player's picks; the final score is worth three. */
export const PICK_ROW_CATEGORIES: Record<keyof Answers | 'final', string[]> = {
  final: ['finalClosest', 'finalWinner', 'finalWithin15'],
  finalAway: [],
  finalHome: [],
  firstTeam: ['firstTeam'],
  firstScoreType: ['firstScoreType'],
  firstTdScorer: ['firstTdScorer'],
  halftime: ['halftime'],
  passTds: ['passTds'],
  rushTds: ['rushTds'],
  missedKick: ['missedKick'],
  leadChange4q: ['leadChange4q'],
  fgs: ['fgs'],
  punts: ['punts'],
  tds: ['tds'],
  turnovers: ['turnovers'],
  longestTd: ['longestTd'],
  sacks: ['sacks'],
};

/** A player's points on one row of their picks, from the game's categories. */
export function rowPoints(
  categories: readonly { key: string; points: Record<string, number> }[],
  row: keyof Answers | 'final',
  playerId: string,
): number {
  const keys = PICK_ROW_CATEGORIES[row];
  return categories.filter((c) => keys.includes(c.key)).reduce((sum, c) => sum + (c.points[playerId] ?? 0), 0);
}

/**
 * The player picker's list: you first whenever you're signed in (even with no picks for the game),
 * then everyone else who made picks.
 */
export function pickerPlayers(withPicks: readonly string[], meId: string | null): string[] {
  return meId ? [meId, ...withPicks.filter((id) => id !== meId)] : [...withPicks];
}

/** Who the player picker starts on: you; signed out, the game's leader; else the first player. */
export function defaultPickerPlayer(ids: readonly string[], meId: string | null, totals: Record<string, number> = {}): string | null {
  if (meId && ids.includes(meId)) return meId;
  const leader = [...ids].sort((a, b) => (totals[b] ?? 0) - (totals[a] ?? 0))[0];
  return leader !== undefined && (totals[leader] ?? 0) > 0 ? leader : (ids[0] ?? null);
}

// --- "Who's getting points", as a compact list ---------------------------------------------

/** Short names for the scoring categories (docs/thanksgiving-spec.md, "Per-game scoreboard"). */
export const CATEGORY_SHORT: Record<CategoryKey, string> = {
  finalClosest: 'Closest score',
  finalWinner: 'Winner',
  finalWithin15: 'Within 15',
  firstTeam: 'First to score',
  firstScoreType: 'First score type',
  firstTdScorer: 'First TD scorer',
  halftime: 'Halftime leader',
  passTds: 'More pass TDs',
  rushTds: 'More rush TDs',
  missedKick: 'Missed kick',
  leadChange4q: '4Q lead change',
  fgs: 'FGs',
  punts: 'Punts',
  tds: 'TDs',
  turnovers: 'Turnovers',
  longestTd: 'Longest TD',
  sacks: 'Sacks',
};

/** A category's worth as numbers only: "1 each" → "1", "1 (5 for safety)" → "1/5". */
export function shortWorth(worth: string): string {
  const nums = worth.match(/\d+/g) ?? [];
  return nums.join('/');
}

/** Who's right, as a count: "—", one name (or "You"), "You + 5", "6 players". */
export function whoCount(ids: readonly string[], names: ReadonlyMap<string, string>, meId: string | null): string {
  const known = ids.filter((id) => names.has(id));
  if (known.length === 0) return '—';
  const mine = meId !== null && known.includes(meId);
  if (known.length === 1) return mine ? 'You' : names.get(known[0])!;
  return mine ? `You + ${known.length - 1}` : `${known.length} players`;
}

// --- Help shown while picking (docs/thanksgiving-spec.md, "Help shown while picking") ---------

/**
 * The reference hint under a number question, from the NFL's per-team average. The questions ask
 * for both teams combined, so it's shown per game (twice the per-team average), except the longest
 * TD: a game's longest is the longer of the two teams', not their sum, so that one stays per team.
 */
export function averageHint(field: 'fgs' | 'punts' | 'tds' | 'turnovers' | 'sacks' | 'longestTd', nfl: TeamAverages | null): string | null {
  if (!nfl || typeof nfl[field] !== 'number') return null;
  if (field === 'longestTd') return `NFL team average longest TD: ${nfl.longestTd} yards`;
  return `NFL average ${Math.round(nfl[field] * 20) / 10} per game`;
}

/** "3 pts", "1 pt", "1/5 pts": a category's worth for its badge. */
export function worthBadge(worth: string): string {
  const n = shortWorth(worth);
  return `${n} ${n === '1' ? 'pt' : 'pts'}`;
}

/**
 * Whether a row of a player's picks is settled and earned them nothing, so it's greyed out: every
 * category behind the row is final and the player got no points from any of them.
 */
export function rowLost(
  categories: readonly { key: string; status: string; points: Record<string, number> }[],
  row: keyof Answers | 'final',
  playerId: string,
): boolean {
  const keys = PICK_ROW_CATEGORIES[row];
  const cats = categories.filter((c) => keys.includes(c.key));
  return cats.length === keys.length && keys.length > 0 && cats.every((c) => c.status === 'final') && rowPoints(cats, row, playerId) === 0;
}

// --- Locked vs live points (docs/thanksgiving-spec.md, "Live scoring") --------------------------

type ScoredCategory = { key: string; status: string; points: Record<string, number> };

/** Whether every category behind a row of a player's picks is final (its points are locked in). */
export function rowLocked(categories: readonly ScoredCategory[], row: keyof Answers | 'final'): boolean {
  const keys = PICK_ROW_CATEGORIES[row];
  const cats = categories.filter((c) => keys.includes(c.key));
  return keys.length > 0 && cats.length === keys.length && cats.every((c) => c.status === 'final');
}

/**
 * Each player's locked points: points from categories that are final, across every game (a finished
 * game's categories are all final). Live points also count categories that could still change.
 */
export function lockedPoints(results: Record<string, { score?: { categories?: readonly ScoredCategory[] } } | undefined>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of Object.values(results)) {
    for (const c of r?.score?.categories ?? []) {
      if (c.status !== 'final') continue;
      for (const [id, pts] of Object.entries(c.points)) out[id] = (out[id] ?? 0) + pts;
    }
  }
  return out;
}

export interface RankedRow {
  playerId: string;
  rank: number;
  locked: number;
  live: number;
}

/**
 * The standings as shown: ordered by locked points, then live points. Once every game is final the
 * two are the same and the published order (with the last-game tiebreaker) is kept.
 */
export function rankStandings(
  rows: readonly { playerId: string; rank: number; total: number }[],
  locked: Record<string, number>,
  final: boolean,
): RankedRow[] {
  const out = rows.map((r) => ({ playerId: r.playerId, rank: r.rank, locked: final ? r.total : (locked[r.playerId] ?? 0), live: r.total }));
  if (final) return out;
  out.sort((a, b) => b.locked - a.locked || b.live - a.live);
  out.forEach((r, i) => {
    const prev = out[i - 1];
    r.rank = prev && prev.locked === r.locked && prev.live === r.live ? prev.rank : i + 1;
  });
  return out;
}

/**
 * Splits text like "CIN 17 – WSH 19" or "WSH ahead" into plain parts and team abbreviations, so
 * the abbreviations can be shown as logos. Only whole-word matches of the given abbreviations count.
 */
export function splitTeams(text: string, abbrs: readonly string[]): ({ text: string } | { team: string })[] {
  const known = abbrs.filter(Boolean).map((a) => a.replace(/[^A-Za-z0-9]/g, ''));
  if (known.length === 0) return text ? [{ text }] : [];
  const re = new RegExp(`\\b(${known.join('|')})\\b`, 'g');
  const out: ({ text: string } | { team: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    out.push({ team: m[1] });
    last = m.index! + m[1].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
