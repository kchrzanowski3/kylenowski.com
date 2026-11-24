// Picks for the test contest's seed players (docs/thanksgiving-spec.md, "Test contest"), so a
// practice game has a full leaderboard to score. Varied but stable: the same player and game always
// get the same answers. Never used by the real contest.

import type { Answers } from './questions';
import type { ScorerOption } from './types';

/** A small deterministic generator (mulberry32) seeded from a string. */
function rng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A full, valid set of 15 answers for one seed player in one game. */
export function seedAnswers(playerName: string, gameId: string, scorers: readonly ScorerOption[]): Answers {
  const r = rng(`${playerName}|${gameId}`);
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  const finalAway = int(10, 35);
  let finalHome = int(10, 35);
  if (finalHome === finalAway) finalHome += 3; // a final score can't be a tie
  const scorerChoices = [...scorers.map((s) => s.id), 'other', 'none'];
  return {
    finalAway,
    finalHome,
    firstTeam: pick(['away', 'home'] as const),
    firstScoreType: pick(['td', 'td', 'fg', 'fg', 'safety'] as const),
    firstTdScorer: pick(scorerChoices),
    halftime: pick(['away', 'home', 'tie'] as const),
    passTds: pick(['away', 'home', 'tie'] as const),
    rushTds: pick(['away', 'home', 'tie'] as const),
    missedKick: r() < 0.4,
    leadChange4q: r() < 0.35,
    fgs: int(1, 6),
    punts: int(3, 12),
    tds: int(2, 8),
    turnovers: int(0, 5),
    longestTd: int(8, 75),
    sacks: int(1, 8),
  };
}
