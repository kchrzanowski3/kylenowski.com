// Vegas projected score (docs/thanksgiving-spec.md, "Help shown while picking"):
//   favorite = (over/under + spread) / 2,  underdog = (over/under - spread) / 2

import type { Line, Projection, Side } from './types';

export function vegasProjection(line: Line): Projection {
  const fav = (line.overUnder + line.spread) / 2;
  const dog = (line.overUnder - line.spread) / 2;
  if (line.favorite === null) return { away: line.overUnder / 2, home: line.overUnder / 2 };
  return line.favorite === 'away' ? { away: fav, home: dog } : { away: dog, home: fav };
}

/**
 * Builds a Line from the feed's odds entry. `details` looks like "DAL -8.5" or "EVEN"; the
 * favorite flags are a fallback when the abbreviation doesn't match either team.
 */
export function parseLine(
  odds: {
    details?: string;
    overUnder?: number;
    spread?: number;
    awayTeamOdds?: { favorite?: boolean };
    homeTeamOdds?: { favorite?: boolean };
  } | null | undefined,
  awayAbbr: string,
  homeAbbr: string,
): Line | null {
  if (!odds || typeof odds.overUnder !== 'number' || !Number.isFinite(odds.overUnder)) return null;
  const details = (odds.details ?? '').trim();
  if (/^(even|pk|pick'?em)$/i.test(details)) {
    return { favorite: null, spread: 0, overUnder: odds.overUnder, details };
  }
  const m = /^([A-Z]{2,4})\s+-?(\d+(?:\.\d+)?)$/i.exec(details);
  let favorite: Side | null = null;
  let spread: number | null = null;
  if (m) {
    const abbr = m[1].toUpperCase();
    spread = Number(m[2]);
    if (abbr === awayAbbr.toUpperCase()) favorite = 'away';
    else if (abbr === homeAbbr.toUpperCase()) favorite = 'home';
  }
  if (favorite === null) {
    if (odds.awayTeamOdds?.favorite) favorite = 'away';
    else if (odds.homeTeamOdds?.favorite) favorite = 'home';
  }
  if (spread === null && typeof odds.spread === 'number') spread = Math.abs(odds.spread);
  if (spread === null) return null;
  if (spread === 0) favorite = null;
  if (favorite === null && spread !== 0) return null;
  return { favorite, spread, overUnder: odds.overUnder, details };
}

/** "25.5" / "22" — projections are always whole or half points. */
export function formatPoints(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
