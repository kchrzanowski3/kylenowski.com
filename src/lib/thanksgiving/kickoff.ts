// Lock times (docs/thanksgiving-spec.md, "Locking and reveal").
// A game locks at its scheduled kickoff, and a lock never reopens.

/**
 * The kickoff (lock) time to store after a refresh, in epoch ms.
 * - Once the stored kickoff has passed, it never changes: the game is locked and its picks are
 *   revealed, so moving it later would reopen picks.
 * - Before that, an admin-set time wins over the feed, and the feed wins otherwise.
 */
export function nextKickoff(args: {
  stored: number | null;
  feed: number | null;
  override: number | null;
  now: number;
}): number | null {
  const { stored, feed, override, now } = args;
  if (stored !== null && stored <= now) return stored;
  if (override !== null) return override;
  if (feed !== null) return feed;
  return stored;
}

/**
 * Whether the admin may set a game's kickoff to `proposed` (used by the admin screen in PR 2).
 * A lock that has already passed can't be moved.
 */
export function canSetKickoff(stored: number | null, now: number): boolean {
  return stored === null || stored > now;
}

export function isLocked(kickoff: number | null, now: number): boolean {
  return kickoff !== null && now >= kickoff;
}
