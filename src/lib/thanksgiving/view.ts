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
