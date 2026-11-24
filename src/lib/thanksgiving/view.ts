// Game data as the page sees it, plus display helpers shared by the components.

import type { Answers } from './questions';
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

/** Who the player picker starts on: you if you're in the list, else the first player. */
export function defaultPickerPlayer(ids: readonly string[], meId: string | null): string | null {
  return meId && ids.includes(meId) ? meId : (ids[0] ?? null);
}
