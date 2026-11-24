// Contest constants (docs/thanksgiving-spec.md, "Games" and "Practice games").

export const SEASON = 2026;
export const TIME_ZONE = 'America/New_York';

/**
 * The contest: which ESPN scoreboard dates its games come from, the ET calendar days those games
 * must fall on, the prefix of its Firestore collections, and the practice players it creates
 * (seedPlayers) or removes (retiredPlayers).
 */
export interface Contest {
  /** ESPN scoreboard dates (YYYYMMDD). Every game on them counts, ordered by kickoff. */
  dates: readonly string[];
  /** The ET calendar days (YYYY-MM-DD) those games are on; a stored game on any other day is removed. */
  daysEt: readonly string[];
  /** Firestore collection prefix: `${prefix}Games`, `${prefix}Players`, ... */
  prefix: 'tg';
  /** Practice players the pre-game refresh creates (without PINs) if they're missing. */
  seedPlayers: readonly string[];
  /** The ET days whose games get seed picks for the seed players. */
  seedPickDays: readonly string[];
  /** Practice players the pre-game refresh removes, with their picks. */
  retiredPlayers: readonly string[];
}

/** Practice games before Thanksgiving: Mon Nov 23 (CIN @ WSH) and Wed Nov 25 (GB @ LAR). */
export const PRACTICE = {
  dates: ['20261123', '20261125'],
  daysEt: ['2026-11-23', '2026-11-25'],
  players: Array.from({ length: 10 }, (_, i) => `Test${i + 1}`),
} as const;

/** Thursday, Nov 26: the games that count. */
export const THANKSGIVING = { dates: ['20261126'], daysEt: ['2026-11-26'] } as const;

/** Until Thursday morning: the practice games, the Thursday games, and the practice players. */
export const PRACTICE_CONTEST: Contest = {
  dates: [...PRACTICE.dates, ...THANKSGIVING.dates],
  daysEt: [...PRACTICE.daysEt, ...THANKSGIVING.daysEt],
  prefix: 'tg',
  seedPlayers: PRACTICE.players,
  seedPickDays: PRACTICE.daysEt,
  retiredPlayers: [],
};

/**
 * From Thursday morning: only the Thursday games. The first refresh after the switch removes the
 * practice games (with their picks and results) and the practice players (with their picks).
 */
export const THANKSGIVING_CONTEST: Contest = {
  dates: THANKSGIVING.dates,
  daysEt: THANKSGIVING.daysEt,
  prefix: 'tg',
  seedPlayers: [],
  seedPickDays: [],
  retiredPlayers: PRACTICE.players,
};

/** 6:00 AM ET Thursday, Nov 26: the switch from the practice contest to the real one. */
export const CUTOVER_MS = Date.parse('2026-11-26T11:00:00Z');

/** The contest in effect at an instant. */
export function contestAt(ms: number): Contest {
  return ms < CUTOVER_MS ? PRACTICE_CONTEST : THANKSGIVING_CONTEST;
}

/** The Thursday whose games count, as ESPN's scoreboard date and as an ET calendar date. */
export const CONTEST_DATE = THANKSGIVING.dates[0];
export const CONTEST_DAY_ET = THANKSGIVING.daysEt[0];

export type CollectionName =
  | 'Games'
  | 'Players'
  | 'Secrets'
  | 'Names'
  | 'Live'
  | 'Overrides'
  | 'Results'
  | 'Standings'
  | 'Meta'
  | 'AdminLog'
  | 'SeasonGames';

/** A contest's collection: col(contest, 'Games') is 'tgGames'. */
export function col(contest: Contest, name: CollectionName): string {
  return `${contest.prefix}${name}`;
}

/** The ET calendar date of an instant, as YYYY-MM-DD. */
export function etDate(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
}

/** "1:00 PM" in ET. */
export function etTime(ms: number): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit' }).format(ms);
}

/** "Thu, Nov 26, 1:00 PM ET". */
export function etDateTime(ms: number): string {
  const d = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, weekday: 'short', month: 'short', day: 'numeric' }).format(ms);
  return `${d}, ${etTime(ms)} ET`;
}
