// Player names and PINs (docs/thanksgiving-spec.md, "Players").

export const NAME_MAX = 20;

/** Tidies a typed name: trims and collapses runs of whitespace. */
export function cleanName(raw: string): string {
  return raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

/** The key that makes names unique ignoring case: "Kyle" and "kyle" share it. */
export function nameKey(raw: string): string {
  return cleanName(raw).toLocaleLowerCase('en-US');
}

/** Returns a problem with the name, or null if it's fine. */
export function nameProblem(raw: string): string | null {
  const name = cleanName(raw);
  if (name.length === 0) return 'Type a name.';
  if (name.length > NAME_MAX) return `Keep it to ${NAME_MAX} characters.`;
  if (!/^[\p{L}\p{N}][\p{L}\p{N} .'\-]*$/u.test(name)) {
    return 'Use letters, numbers, spaces and . \' - only.';
  }
  return null;
}

export function isValidPin(pin: unknown): pin is string {
  return typeof pin === 'string' && /^[0-9]{4}$/.test(pin);
}

/** Wrong guesses allowed before a PIN starts locking. */
export const FREE_PIN_GUESSES = 5;
const BASE_LOCK_MS = 60_000;
const MAX_LOCK_MS = 60 * 60_000;

/**
 * How long a name is locked after `failures` wrong PINs in a row: nothing for the first
 * FREE_PIN_GUESSES, then 1 minute, doubling each time, up to 1 hour. Trying all 10,000 PINs
 * would take over a year.
 */
export function pinLockMs(failures: number): number {
  if (failures < FREE_PIN_GUESSES) return 0;
  return Math.min(MAX_LOCK_MS, BASE_LOCK_MS * 2 ** (failures - FREE_PIN_GUESSES));
}
