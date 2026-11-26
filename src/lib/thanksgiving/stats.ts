// What happened in a game, as the scoring needs it (docs/thanksgiving-spec.md, "Scoring rules"),
// derived from ESPN's game-summary feed. Pure: JSON in, plain values out. Overtime counts toward
// every stat (the box score and scoring plays cover the whole game), except the 4th-quarter lead
// change, which only looks at the 4th quarter.

import { playYards } from './espn';
import type { Side } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

export type ScoreType = 'td' | 'fg' | 'safety';

export interface ScoringPlaySummary {
  id: string;
  side: Side;
  type: ScoreType;
  text: string;
}

export interface GameStats {
  state: 'pre' | 'in' | 'post';
  period: number; // 0 before kickoff; 5+ is overtime
  clock: string | null; // "11:04"
  /** Halftime has been reached, so the halftime score can't change any more. */
  halftimeReached: boolean;
  away: number;
  home: number;
  firstScore: { side: Side; type: ScoreType } | null;
  /** The first touchdown. scorerId is the ESPN athlete id when known. */
  firstTd: { side: Side; playId: string; scorerId: string | null; scorerName: string } | null;
  /** Most recent scoring play from the feed, for live play headlines. */
  lastScoringPlay?: ScoringPlaySummary | null;
  /** Score at the end of the 2nd quarter (the current score until then). */
  halftime: { away: number; home: number };
  passTds: { away: number; home: number };
  rushTds: { away: number; home: number };
  missedKick: boolean;
  leadChange4q: boolean;
  fgs: number;
  punts: number;
  tds: number;
  turnovers: number;
  longestTd: number;
  sacks: number;
}

export interface FeedStatus {
  state: 'pre' | 'in' | 'post';
  period: number;
  clock: string | null;
  /** ESPN's status name, e.g. STATUS_HALFTIME. */
  name: string;
}

const int = (v: unknown): number => {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : 0;
};

/** A team's box-score total for one column of a player group; "4/5" counts as [4, 5]. */
function total(summary: Json, teamId: string, group: string, key: string): [number, number] {
  const team = summary?.boxscore?.players?.find((p: Json) => String(p?.team?.id) === teamId);
  const g = team?.statistics?.find((s: Json) => s?.name === group);
  const i = (g?.keys ?? []).indexOf(key);
  if (!g || i < 0 || !Array.isArray(g.totals) || g.totals.length === 0) return [0, 0];
  const [a, b] = String(g.totals[i]).split('/');
  return [int(a), int(b)];
}

function teamStat(summary: Json, teamId: string, name: string): string {
  const t = summary?.boxscore?.teams?.find((x: Json) => String(x?.team?.id) === teamId);
  return String(t?.statistics?.find((x: Json) => x?.name === name)?.displayValue ?? '');
}

/** "DJ Moore 4 Yd pass from Josh Allen (…)" → "DJ Moore". */
export function scorerNameFromText(text: string): string {
  const t = (text ?? '').trim();
  const m = /^(.+?)\s+\d+\s*Yd\b/i.exec(t) ?? /^(.+?)\s+(?:Fumble|Interception|Blocked|Kick|Punt|Pass|Run|Rush)\b/i.exec(t);
  return (m ? m[1] : t).trim();
}

/** Trims routine "(Kicker Kick)" PAT suffixes while keeping failed PATs / 2-pt notes. */
export function cleanScoringPlayText(text: string): string {
  return String(text ?? '')
    .trim()
    .replace(/\s*\([^)]*\bKick\)$/i, '')
    .trim();
}

const SCORE_TYPES: Record<string, ScoreType> = { TD: 'td', FG: 'fg', SF: 'safety' };

/** The feed's game status (from the scoreboard, or the summary's header). */
export function feedStatus(competition: Json): FeedStatus {
  const s = competition?.status ?? {};
  const state = s?.type?.state === 'in' || s?.type?.state === 'post' ? s.type.state : 'pre';
  return { state, period: int(s.period), clock: s.displayClock ?? null, name: String(s?.type?.name ?? '') };
}

/**
 * Everything the 15 questions need, from a game summary and its status. `firstTdScorerId` is the
 * ESPN athlete id of the first TD's scorer when the caller has looked it up (the core-API play's
 * "scorer" participant); otherwise only the name from the play text is known.
 */
export function deriveGameStats(summary: Json, status: FeedStatus, firstTdScorerId: string | null = null): GameStats {
  const comp = summary?.header?.competitions?.[0];
  const awayC = comp?.competitors?.find((x: Json) => x.homeAway === 'away');
  const homeC = comp?.competitors?.find((x: Json) => x.homeAway === 'home');
  const ids: Record<Side, string> = { away: String(awayC?.team?.id ?? ''), home: String(homeC?.team?.id ?? '') };
  const sideOf = (teamId: unknown): Side => (String(teamId) === ids.home ? 'home' : 'away');

  const plays: Json[] = (summary?.scoringPlays ?? []).filter((p: Json) => p?.scoringType?.abbreviation);
  const last = plays[plays.length - 1];
  const away = status.state === 'pre' ? 0 : int(awayC?.score ?? last?.awayScore);
  const home = status.state === 'pre' ? 0 : int(homeC?.score ?? last?.homeScore);

  const scoredPlays = plays.filter((p) => SCORE_TYPES[p.scoringType.abbreviation]);
  const first = scoredPlays[0];
  const lastScored = scoredPlays[scoredPlays.length - 1];
  const tdPlays = plays.filter((p) => p.scoringType.abbreviation === 'TD');
  const firstTdPlay = tdPlays[0];

  // Score at halftime: after the last scoring play of the first half.
  const firstHalf = plays.filter((p) => int(p?.period?.number) <= 2);
  const lastFirstHalf = firstHalf[firstHalf.length - 1];
  const halftimeReached = status.state === 'post' || status.period >= 3 || status.name === 'STATUS_HALFTIME';
  const halftime = halftimeReached
    ? { away: int(lastFirstHalf?.awayScore), home: int(lastFirstHalf?.homeScore) }
    : { away, home };

  // 4th-quarter lead change: a team goes ahead when it was tied or behind just before that play.
  let leadChange4q = false;
  let margin = 0; // home minus away, before the current play
  for (const p of plays) {
    const period = int(p?.period?.number);
    if (period > 4) break; // overtime isn't the 4th quarter
    const m = int(p.homeScore) - int(p.awayScore);
    if (period === 4 && m !== 0 && (margin === 0 || Math.sign(margin) !== Math.sign(m))) leadChange4q = true;
    margin = m;
  }

  const both = (group: string, key: string, i: 0 | 1 = 0) => total(summary, ids.away, group, key)[i] + total(summary, ids.home, group, key)[i];
  const fgMade = both('kicking', 'fieldGoalsMade/fieldGoalAttempts', 0);
  const fgAtt = both('kicking', 'fieldGoalsMade/fieldGoalAttempts', 1);
  const xpMade = both('kicking', 'extraPointsMade/extraPointAttempts', 0);
  const xpAtt = both('kicking', 'extraPointsMade/extraPointAttempts', 1);
  const sacked = (teamId: string) => int(teamStat(summary, teamId, 'sacksYardsLost').split('-')[0]);

  return {
    state: status.state,
    period: status.period,
    clock: status.clock,
    halftimeReached,
    away,
    home,
    firstScore: first ? { side: sideOf(first.team?.id), type: SCORE_TYPES[first.scoringType.abbreviation] } : null,
    firstTd: firstTdPlay
      ? {
          side: sideOf(firstTdPlay.team?.id),
          playId: String(firstTdPlay.id),
          scorerId: firstTdScorerId,
          scorerName: scorerNameFromText(firstTdPlay.text),
        }
      : null,
    lastScoringPlay: lastScored
      ? {
          id: String(lastScored.id ?? ''),
          side: sideOf(lastScored.team?.id),
          type: SCORE_TYPES[lastScored.scoringType.abbreviation],
          text: cleanScoringPlayText(lastScored.text),
        }
      : null,
    halftime,
    passTds: {
      away: total(summary, ids.away, 'passing', 'passingTouchdowns')[0],
      home: total(summary, ids.home, 'passing', 'passingTouchdowns')[0],
    },
    rushTds: {
      away: total(summary, ids.away, 'rushing', 'rushingTouchdowns')[0],
      home: total(summary, ids.home, 'rushing', 'rushingTouchdowns')[0],
    },
    // Any missed or blocked extra point or field goal (blocked kicks count as attempts). A failed
    // 2-point try isn't a kick, so it isn't counted.
    missedKick: fgAtt > fgMade || xpAtt > xpMade,
    leadChange4q,
    fgs: fgMade,
    punts: both('punting', 'punts'),
    tds: tdPlays.length,
    turnovers: int(teamStat(summary, ids.away, 'turnovers')) + int(teamStat(summary, ids.home, 'turnovers')),
    longestTd: tdPlays.reduce((m, p) => Math.max(m, playYards(p.text)), 0),
    sacks: sacked(ids.away) + sacked(ids.home),
  };
}

/** A game that hasn't kicked off: all zeros. */
export function preGameStats(): GameStats {
  return {
    state: 'pre', period: 0, clock: null, halftimeReached: false, away: 0, home: 0,
    firstScore: null, firstTd: null, lastScoringPlay: null, halftime: { away: 0, home: 0 },
    passTds: { away: 0, home: 0 }, rushTds: { away: 0, home: 0 },
    missedKick: false, leadChange4q: false, fgs: 0, punts: 0, tds: 0, turnovers: 0, longestTd: 0, sacks: 0,
  };
}

/** The ESPN athlete id of a core-API play's "scorer" participant. */
export function scorerIdFromCorePlay(play: Json): string | null {
  const p = (play?.participants ?? []).find((x: Json) => x?.type === 'scorer');
  const m = /\/athletes\/(\d+)/.exec(p?.athlete?.$ref ?? '');
  return m ? m[1] : null;
}
