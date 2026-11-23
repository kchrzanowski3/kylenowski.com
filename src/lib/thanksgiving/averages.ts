// Reference averages (docs/thanksgiving-spec.md, "Help shown while picking"): each team's own
// per-game numbers this season, plus the NFL average per team per game.

import type { TeamAverages, TeamGameStats } from './types';

const FIELDS = ['points', 'fgs', 'punts', 'tds', 'turnovers', 'sacks', 'longestTd'] as const;

export function average(games: TeamGameStats[]): TeamAverages | null {
  if (games.length === 0) return null;
  const out: TeamAverages = { games: games.length, points: 0, fgs: 0, punts: 0, tds: 0, turnovers: 0, sacks: 0, longestTd: 0 };
  for (const f of FIELDS) {
    out[f] = round1(games.reduce((s, g) => s + g[f], 0) / games.length);
  }
  return out;
}

/** Per team (by ESPN team id), and for the whole NFL (every team-game counted once). */
export function seasonAverages(teamGames: { teamId: string; stats: TeamGameStats }[]): {
  byTeam: Record<string, TeamAverages>;
  nfl: TeamAverages | null;
} {
  const grouped = new Map<string, TeamGameStats[]>();
  for (const { teamId, stats } of teamGames) {
    if (!grouped.has(teamId)) grouped.set(teamId, []);
    grouped.get(teamId)!.push(stats);
  }
  const byTeam: Record<string, TeamAverages> = {};
  for (const [id, games] of grouped) byTeam[id] = average(games)!;
  return { byTeam, nfl: average(teamGames.map((t) => t.stats)) };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
