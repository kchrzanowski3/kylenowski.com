// Contest constants (docs/thanksgiving-spec.md, "Games" and "Test contest").

export const SEASON = 2026;
export const TIME_ZONE = 'America/New_York';

/**
 * One contest: which ESPN scoreboard dates its games come from, the ET calendar days those games
 * must fall on, and the prefix of its Firestore collections (tgGames, tgTestGames, ...). The same
 * pages, functions and rules run every contest; only this changes.
 */
export interface Contest {
  /** 'thanksgiving' for the real game; sent to the functions as ?contest= for any other. */
  id: 'thanksgiving' | 'test';
  /** ESPN scoreboard dates (YYYYMMDD). Every game on them counts, ordered by kickoff. */
  dates: readonly string[];
  /** The ET calendar days (YYYY-MM-DD) those games are on; a game on any other day is ignored. */
  daysEt: readonly string[];
  /** Firestore collection prefix: `${prefix}Games`, `${prefix}Players`, ... */
  prefix: 'tg' | 'tgTest';
  /** The page; its admin screen is `${path}/admin`. */
  path: string;
  /** Players the pre-game refresh creates (without PINs) if they're missing. Test contest only. */
  seedPlayers: readonly string[];
}

export const REAL_CONTEST: Contest = {
  id: 'thanksgiving',
  dates: ['20261126'],
  daysEt: ['2026-11-26'],
  prefix: 'tg',
  path: '/thanksgiving',
  seedPlayers: [],
};

export const TEST_CONTEST: Contest = {
  id: 'test',
  dates: ['20261123', '20261125'],
  daysEt: ['2026-11-23', '2026-11-25'],
  prefix: 'tgTest',
  path: '/thanksgiving-test',
  seedPlayers: Array.from({ length: 10 }, (_, i) => `Test${i + 1}`),
};

/** The Thursday whose games count, as ESPN's scoreboard date and as an ET calendar date. */
export const CONTEST_DATE = REAL_CONTEST.dates[0];
export const CONTEST_DAY_ET = REAL_CONTEST.daysEt[0];

/**
 * The contest a request or page names. No name (or 'thanksgiving') is the real contest, so callers
 * that don't know about contests keep working unchanged; an unknown name is null.
 */
export function contestById(id: unknown): Contest | null {
  if (id === undefined || id === null || id === '' || id === REAL_CONTEST.id) return REAL_CONTEST;
  if (id === TEST_CONTEST.id) return TEST_CONTEST;
  return null;
}

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

/** A contest's collection: col(REAL_CONTEST, 'Games') is 'tgGames'; for the test contest, 'tgTestGames'. */
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
