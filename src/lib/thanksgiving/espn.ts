// Parsers for ESPN's public NFL feeds (unofficial; see docs/thanksgiving-spec.md, "Data").
// Everything here is pure: JSON in, plain values out. Fetching lives in functions/src/espn-fetch.ts.

import { parseLine } from './projection';
import type { Line, Side, TeamGameStats, TeamInfo } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

export const ESPN_SITE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
export const ESPN_CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl';

export interface FeedGame {
  espnId: string;
  kickoff: number; // epoch ms
  away: TeamInfo;
  home: TeamInfo;
  line: Line | null;
  tv: string | null;
  state: 'pre' | 'in' | 'post';
}

function teamInfo(t: Json): TeamInfo {
  return {
    id: String(t?.id ?? ''),
    abbr: String(t?.abbreviation ?? ''),
    name: String(t?.displayName ?? ''),
    shortName: String(t?.shortDisplayName ?? t?.name ?? ''),
    color: typeof t?.color === 'string' && /^[0-9a-f]{6}$/i.test(t.color) ? t.color : null,
  };
}

/** The games on a scoreboard, in kickoff order. */
export function parseScoreboard(sb: Json): FeedGame[] {
  const games: FeedGame[] = [];
  for (const e of sb?.events ?? []) {
    const c = e?.competitions?.[0];
    if (!c) continue;
    const away = c.competitors?.find((x: Json) => x.homeAway === 'away');
    const home = c.competitors?.find((x: Json) => x.homeAway === 'home');
    const kickoff = Date.parse(c.date ?? e.date);
    if (!away || !home || !Number.isFinite(kickoff)) continue;
    const a = teamInfo(away.team);
    const h = teamInfo(home.team);
    const state = c.status?.type?.state ?? e.status?.type?.state;
    games.push({
      espnId: String(e.id),
      kickoff,
      away: a,
      home: h,
      line: parseLine(c.odds?.[0], a.abbr, h.abbr),
      tv: c.broadcasts?.[0]?.names?.[0] ?? c.geoBroadcasts?.[0]?.media?.shortName ?? null,
      state: state === 'in' || state === 'post' ? state : 'pre',
    });
  }
  return games.sort((x, y) => x.kickoff - y.kickoff || x.espnId.localeCompare(y.espnId));
}

/** Completed games on a scoreboard (used for the season averages). */
export function completedEventIds(sb: Json): string[] {
  return (sb?.events ?? [])
    .filter((e: Json) => e?.competitions?.[0]?.status?.type?.completed === true)
    .map((e: Json) => String(e.id));
}

function int(v: unknown): number {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : 0;
}

/** A team's total for one column of a box-score player group (e.g. punting → punts). */
function groupTotal(summary: Json, teamId: string, group: string, key: string): number {
  const team = summary?.boxscore?.players?.find((p: Json) => String(p?.team?.id) === teamId);
  const g = team?.statistics?.find((s: Json) => s?.name === group);
  if (!g) return 0;
  const i = (g.keys ?? []).indexOf(key);
  if (i < 0 || !Array.isArray(g.totals) || g.totals.length === 0) return 0;
  return int(String(g.totals[i]).split('/')[0]); // "4/5" -> 4 made
}

function teamStat(summary: Json, teamId: string, name: string): string | null {
  const t = summary?.boxscore?.teams?.find((x: Json) => String(x?.team?.id) === teamId);
  const s = t?.statistics?.find((x: Json) => x?.name === name);
  return s ? String(s.displayValue) : null;
}

/** Yards on a scoring play, from its text ("DJ Moore 4 Yd pass from Josh Allen"). */
export function playYards(text: string): number {
  const m = /(\d+)\s*Yd/i.exec(text ?? '');
  return m ? int(m[1]) : 0;
}

/**
 * Each team's own numbers in one completed game, from a game-summary feed. Overtime is included
 * (the box score covers the whole game). Definitions match the spec's reference averages:
 * turnovers are those the team committed; sacks are those its defense made.
 */
export function deriveTeamGameStats(summary: Json): { home: TeamGameStats; away: TeamGameStats; homeId: string; awayId: string } | null {
  const comp = summary?.header?.competitions?.[0];
  const away = comp?.competitors?.find((x: Json) => x.homeAway === 'away');
  const home = comp?.competitors?.find((x: Json) => x.homeAway === 'home');
  if (!away || !home) return null;
  const ids: Record<Side, string> = { away: String(away.team?.id ?? away.id), home: String(home.team?.id ?? home.id) };
  const scores: Record<Side, number> = { away: int(away.score), home: int(home.score) };
  const tdPlays = (summary?.scoringPlays ?? []).filter((p: Json) => p?.scoringType?.abbreviation === 'TD');

  const stats = (side: Side): TeamGameStats => {
    const id = ids[side];
    const oppId = ids[side === 'away' ? 'home' : 'away'];
    const mine = tdPlays.filter((p: Json) => String(p?.team?.id) === id);
    const sacksTaken = teamStat(summary, oppId, 'sacksYardsLost'); // "3-24": the opponent was sacked 3 times
    return {
      points: scores[side],
      fgs: groupTotal(summary, id, 'kicking', 'fieldGoalsMade/fieldGoalAttempts'),
      punts: groupTotal(summary, id, 'punting', 'punts'),
      tds: mine.length,
      turnovers: int(teamStat(summary, id, 'turnovers')),
      sacks: sacksTaken ? int(sacksTaken.split('-')[0]) : 0,
      longestTd: mine.reduce((max: number, p: Json) => Math.max(max, playYards(p.text)), 0),
    };
  };
  return { away: stats('away'), home: stats('home'), awayId: ids.away, homeId: ids.home };
}

/** The athlete id at the end of a core-API $ref URL. */
export function athleteIdFromRef(ref: string): string | null {
  const m = /\/athletes\/(\d+)/.exec(ref ?? '');
  return m ? m[1] : null;
}
