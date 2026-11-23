// Contest constants (docs/thanksgiving-spec.md, "Games").

export const SEASON = 2026;
/** The Thursday whose games count, as ESPN's scoreboard date and as an ET calendar date. */
export const CONTEST_DATE = '20261126';
export const CONTEST_DAY_ET = '2026-11-26';
export const TIME_ZONE = 'America/New_York';

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
