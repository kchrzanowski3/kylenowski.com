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
  { key: 'fgs', label: 'Total field goals made', hint: 'Both teams combined.', max: 20, avg: 'fgs', unit: 'field goals made' },
  { key: 'punts', label: 'Total punts', hint: 'Both teams combined.', max: 30, avg: 'punts', unit: 'punts' },
  { key: 'tds', label: 'Total touchdowns', hint: 'Both teams, any kind of TD.', max: 20, avg: 'tds', unit: 'TDs' },
  { key: 'turnovers', label: 'Combined turnovers', hint: 'Interceptions and lost fumbles (both teams).', max: 20, avg: 'turnovers', unit: 'turnovers' },
  { key: 'longestTd', label: 'Yards on the longest TD', hint: 'Any kind of TD; enter 0 if no TD.', max: 109, avg: 'longestTd', unit: 'yards' },
  { key: 'sacks', label: 'Combined sacks', hint: 'Both teams combined.', max: 30, avg: 'sacks', unit: 'sacks' },
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

export type QuestionKey = 'final' | Exclude<AnswerKey, 'finalAway' | 'finalHome'>;

export const QUESTION_LABELS: Record<QuestionKey, string> = {
  final: 'Final score',
  firstTeam: 'Which team scores first',
  firstScoreType: 'First score type',
  firstTdScorer: 'First TD scorer',
  halftime: 'Halftime leader',
  passTds: 'More passing TDs',
  rushTds: 'More rushing TDs',
  missedKick: 'Missed extra point or field goal',
  leadChange4q: 'Lead change in the 4th quarter',
  fgs: 'Total field goals made',
  punts: 'Total punts',
  tds: 'Total touchdowns',
  turnovers: 'Combined turnovers',
  longestTd: 'Yards on the longest TD',
  sacks: 'Combined sacks',
};

export const QUESTION_SECTIONS = [
  { id: 'score-firsts', title: 'Score & Firsts', questions: ['final', 'firstTeam', 'firstScoreType', 'firstTdScorer'] },
  { id: 'game-flow', title: 'Game Flow', questions: ['halftime', 'passTds', 'rushTds', 'missedKick', 'leadChange4q'] },
  { id: 'stat-totals', title: 'Stat Totals', questions: ['fgs', 'punts', 'tds', 'turnovers', 'longestTd', 'sacks'] },
] as const satisfies readonly { id: string; title: string; questions: readonly QuestionKey[] }[];

export interface AnswerProblem {
  question: QuestionKey | null;
  label: string;
  inline: string;
  message: string;
}

const SIDES = ['away', 'home'];
const SIDES_OR_TIE = ['away', 'home', 'tie'];
const SCORE_TYPES = ['td', 'fg', 'safety'];
const SCORER_RE = /^([0-9]{1,12}|other|none)$/;

function isInt(v: unknown, lo: number, hi: number): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
}

/**
 * Returns structured validation problems with plain-English labels and inline messages for the
 * pick form. Every question is optional, since a skipped question just scores 0. Mirrors
 * validAnswers() in firestore.rules.
 */
export function answerProblemDetails(a: Record<string, unknown>): AnswerProblem[] {
  const problems: AnswerProblem[] = [];
  for (const k of Object.keys(a)) {
    if (!(ANSWER_KEYS as readonly string[]).includes(k)) {
      problems.push({
        question: null,
        label: 'Unknown answer',
        inline: `Unknown answer "${k}".`,
        message: `unknown answer "${k}"`,
      });
    }
  }
  const has = (k: AnswerKey) => a[k] !== undefined;

  if (has('finalAway') !== has('finalHome')) {
    problems.push({
      question: 'final',
      label: QUESTION_LABELS.final,
      inline: 'Enter both teams’ scores.',
      message: 'final score needs both teams',
    });
  }
  const badAway = has('finalAway') && !isInt(a.finalAway, 0, FINAL_SCORE_MAX);
  const badHome = has('finalHome') && !isInt(a.finalHome, 0, FINAL_SCORE_MAX);
  if (badAway || badHome) {
    problems.push({
      question: 'final',
      label: QUESTION_LABELS.final,
      inline: `Enter whole numbers from 0 to ${FINAL_SCORE_MAX}.`,
      message: `${QUESTION_LABELS.final} must be a whole number 0–${FINAL_SCORE_MAX}`,
    });
  }
  if (has('finalAway') && has('finalHome') && a.finalAway === a.finalHome) {
    problems.push({
      question: 'final',
      label: QUESTION_LABELS.final,
      inline: 'Final score can’t be a tie.',
      message: "final score can't be a tie",
    });
  }
  if (has('firstTeam') && !SIDES.includes(a.firstTeam as string)) {
    problems.push({
      question: 'firstTeam',
      label: QUESTION_LABELS.firstTeam,
      inline: 'Pick one of the two teams.',
      message: `${QUESTION_LABELS.firstTeam} must be away or home`,
    });
  }
  if (has('firstScoreType') && !SCORE_TYPES.includes(a.firstScoreType as string)) {
    problems.push({
      question: 'firstScoreType',
      label: QUESTION_LABELS.firstScoreType,
      inline: 'Pick TD, FG, or Safety.',
      message: `${QUESTION_LABELS.firstScoreType} must be TD, FG or safety`,
    });
  }
  if (has('firstTdScorer') && !(typeof a.firstTdScorer === 'string' && SCORER_RE.test(a.firstTdScorer))) {
    problems.push({
      question: 'firstTdScorer',
      label: QUESTION_LABELS.firstTdScorer,
      inline: 'Pick a listed player, Other player, or No TD.',
      message: `${QUESTION_LABELS.firstTdScorer} must be a player, other or none`,
    });
  }
  for (const k of ['halftime', 'passTds', 'rushTds'] as const) {
    if (has(k) && !SIDES_OR_TIE.includes(a[k] as string)) {
      problems.push({
        question: k,
        label: QUESTION_LABELS[k],
        inline: 'Pick either team or Tie.',
        message: `${QUESTION_LABELS[k]} must be away, home or tie`,
      });
    }
  }
  for (const k of ['missedKick', 'leadChange4q'] as const) {
    if (has(k) && typeof a[k] !== 'boolean') {
      problems.push({
        question: k,
        label: QUESTION_LABELS[k],
        inline: 'Pick Yes or No.',
        message: `${QUESTION_LABELS[k]} must be yes or no`,
      });
    }
  }
  for (const q of NUMBER_QUESTIONS) {
    if (has(q.key) && !isInt(a[q.key], 0, q.max)) {
      problems.push({
        question: q.key,
        label: q.label,
        inline: `Enter a whole number from 0 to ${q.max}.`,
        message: `${q.label} must be a whole number 0–${q.max}`,
      });
    }
  }
  return problems;
}

/**
 * Returns a list of problems with a set of answers (empty when valid). Every question is optional,
 * since a skipped question just scores 0. Mirrors validAnswers() in firestore.rules.
 */
export function answerProblems(a: Record<string, unknown>): string[] {
  return answerProblemDetails(a).map((p) => p.message);
}

/**
 * The answers that can be saved now: everything except the answers with a problem (a half-entered
 * or tied final score, an out-of-range number). Saving these keeps the rest of a player's picks
 * safe while they finish one question.
 */
export function savableAnswers(a: Answers): Answers {
  const out: Record<string, unknown> = {};
  const entries = Object.entries(a).filter(([k]) => k !== 'finalAway' && k !== 'finalHome');
  for (const [k, v] of entries) {
    if (answerProblems({ [k]: v }).length === 0) out[k] = v;
  }
  const final = { finalAway: a.finalAway, finalHome: a.finalHome };
  if (answerProblems(compactAnswers(final) as Record<string, unknown>).length === 0) Object.assign(out, compactAnswers(final));
  return out as Answers;
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

/** Whether a single question has a value entered (final score requires both teams). */
export function isQuestionAnswered(a: Answers, key: QuestionKey): boolean {
  if (key === 'final') return a.finalAway !== undefined && a.finalHome !== undefined;
  return a[key] !== undefined;
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
