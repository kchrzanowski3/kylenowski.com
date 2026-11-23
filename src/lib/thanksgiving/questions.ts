// The 15 questions asked for every game (docs/thanksgiving-spec.md, "Questions").
// firestore.rules validates the same answer shapes; tests/emulator/rules.test.ts keeps them in step.

import type { Side, SideOrTie } from './types';

export interface Answers {
  finalAway?: number;
  finalHome?: number;
  firstTeam?: Side;
  firstScoreType?: 'td' | 'fg' | 'safety';
  /** ESPN athlete id, 'other' or 'none' ("No TD"). */
  firstTdScorer?: string;
  halftime?: SideOrTie;
  passTds?: SideOrTie;
  rushTds?: SideOrTie;
  missedKick?: boolean;
  leadChange4q?: boolean;
  fgs?: number;
  punts?: number;
  tds?: number;
  turnovers?: number;
  longestTd?: number;
  sacks?: number;
}

export type AnswerKey = keyof Answers;

/** Number questions that are scored "closest wins", with the range a guess must fall in. */
export const NUMBER_QUESTIONS = [
  { key: 'fgs', label: 'Total field goals made', hint: 'both teams', max: 20, avg: 'fgs', unit: 'field goals made' },
  { key: 'punts', label: 'Total punts', hint: 'both teams', max: 30, avg: 'punts', unit: 'punts' },
  { key: 'tds', label: 'Total touchdowns', hint: 'both teams, any kind', max: 20, avg: 'tds', unit: 'TDs' },
  { key: 'turnovers', label: 'Combined turnovers', hint: 'interceptions + lost fumbles', max: 20, avg: 'turnovers', unit: 'turnovers' },
  { key: 'longestTd', label: 'Yards on the longest TD', hint: 'any kind of TD; 0 if no TD', max: 109, avg: 'longestTd', unit: 'yards' },
  { key: 'sacks', label: 'Combined sacks', hint: 'both teams', max: 30, avg: 'sacks', unit: 'sacks' },
] as const;

export const FINAL_SCORE_MAX = 99;

export const ANSWER_KEYS: readonly AnswerKey[] = [
  'finalAway',
  'finalHome',
  'firstTeam',
  'firstScoreType',
  'firstTdScorer',
  'halftime',
  'passTds',
  'rushTds',
  'missedKick',
  'leadChange4q',
  'fgs',
  'punts',
  'tds',
  'turnovers',
  'longestTd',
  'sacks',
];

const SIDES = ['away', 'home'];
const SIDES_OR_TIE = ['away', 'home', 'tie'];
const SCORE_TYPES = ['td', 'fg', 'safety'];
const SCORER_RE = /^([0-9]{1,12}|other|none)$/;

function isInt(v: unknown, lo: number, hi: number): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
}

/**
 * Returns a list of problems with a set of answers (empty when valid). Every question is optional,
 * since a skipped question just scores 0. Mirrors validAnswers() in firestore.rules.
 */
export function answerProblems(a: Record<string, unknown>): string[] {
  const problems: string[] = [];
  for (const k of Object.keys(a)) {
    if (!(ANSWER_KEYS as readonly string[]).includes(k)) problems.push(`unknown answer "${k}"`);
  }
  const has = (k: AnswerKey) => a[k] !== undefined;

  if (has('finalAway') !== has('finalHome')) problems.push('final score needs both teams');
  for (const k of ['finalAway', 'finalHome'] as const) {
    if (has(k) && !isInt(a[k], 0, FINAL_SCORE_MAX)) problems.push(`${k} must be a whole number 0–${FINAL_SCORE_MAX}`);
  }
  if (has('finalAway') && has('finalHome') && a.finalAway === a.finalHome) {
    problems.push("final score can't be a tie");
  }
  if (has('firstTeam') && !SIDES.includes(a.firstTeam as string)) problems.push('firstTeam must be away or home');
  if (has('firstScoreType') && !SCORE_TYPES.includes(a.firstScoreType as string)) {
    problems.push('firstScoreType must be td, fg or safety');
  }
  if (has('firstTdScorer') && !(typeof a.firstTdScorer === 'string' && SCORER_RE.test(a.firstTdScorer))) {
    problems.push('firstTdScorer must be a player, other or none');
  }
  for (const k of ['halftime', 'passTds', 'rushTds'] as const) {
    if (has(k) && !SIDES_OR_TIE.includes(a[k] as string)) problems.push(`${k} must be away, home or tie`);
  }
  for (const k of ['missedKick', 'leadChange4q'] as const) {
    if (has(k) && typeof a[k] !== 'boolean') problems.push(`${k} must be yes or no`);
  }
  for (const q of NUMBER_QUESTIONS) {
    if (has(q.key) && !isInt(a[q.key], 0, q.max)) problems.push(`${q.key} must be a whole number 0–${q.max}`);
  }
  return problems;
}

/** Drops unanswered (undefined/null/'') entries so they can be stored as "skipped". */
export function compactAnswers(a: Record<string, unknown>): Answers {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(a)) {
    if (v === undefined || v === null || v === '') continue;
    out[k] = v;
  }
  return out as Answers;
}

/** How many of the 15 questions are answered (final score counts once). */
export function answeredCount(a: Answers): number {
  let n = 0;
  if (a.finalAway !== undefined && a.finalHome !== undefined) n++;
  for (const k of ANSWER_KEYS) {
    if (k === 'finalAway' || k === 'finalHome') continue;
    if (a[k] !== undefined) n++;
  }
  return n;
}

export const QUESTION_COUNT = 15;
