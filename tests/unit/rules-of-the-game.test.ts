// Pure rules from docs/thanksgiving-spec.md that PR 1 relies on: the Vegas projection, answer
// validation, names and PINs, lock times and the reference averages.
import { describe, expect, it } from 'vitest';
import { average, seasonAverages } from '../../src/lib/thanksgiving/averages';
import { isLocked, nextKickoff } from '../../src/lib/thanksgiving/kickoff';
import { FREE_PIN_GUESSES, cleanName, isValidPin, nameKey, nameProblem, pinLockMs } from '../../src/lib/thanksgiving/players';
import { formatPoints, parseLine, vegasProjection } from '../../src/lib/thanksgiving/projection';
import {
  QUESTION_COUNT,
  QUESTION_SECTIONS,
  answerProblemDetails,
  answerProblems,
  answeredCount,
  compactAnswers,
  isQuestionAnswered,
  savableAnswers,
} from '../../src/lib/thanksgiving/questions';
import type { TeamGameStats } from '../../src/lib/thanksgiving/types';

describe('Vegas projected score', () => {
  it('matches the spec example: DAL -3.5, O/U 47.5 -> DAL 25.5, PHI 22', () => {
    const line = parseLine({ details: 'DAL -3.5', overUnder: 47.5 }, 'PHI', 'DAL')!;
    expect(line).toEqual({ favorite: 'home', spread: 3.5, overUnder: 47.5, details: 'DAL -3.5' });
    expect(vegasProjection(line)).toEqual({ away: 22, home: 25.5 });
  });

  it('works for an away favorite (CHI -2.5, O/U 55.5 -> CHI 29, DET 26.5)', () => {
    const line = parseLine({ details: 'CHI -2.5', overUnder: 55.5 }, 'CHI', 'DET')!;
    expect(vegasProjection(line)).toEqual({ away: 29, home: 26.5 });
  });

  it('splits the total evenly for a pick\'em', () => {
    const line = parseLine({ details: 'EVEN', overUnder: 45 }, 'KC', 'BUF')!;
    expect(line.favorite).toBeNull();
    expect(vegasProjection(line)).toEqual({ away: 22.5, home: 22.5 });
  });

  it('falls back to the favorite flags when the text has no team', () => {
    const line = parseLine({ details: '', overUnder: 50.5, spread: -3, homeTeamOdds: { favorite: true } }, 'KC', 'BUF')!;
    expect(line).toMatchObject({ favorite: 'home', spread: 3 });
  });

  it('has no projection without a total', () => {
    expect(parseLine({ details: 'DAL -3.5' }, 'PHI', 'DAL')).toBeNull();
    expect(parseLine(undefined, 'PHI', 'DAL')).toBeNull();
  });

  it('formats half points', () => {
    expect(formatPoints(25.5)).toBe('25.5');
    expect(formatPoints(22)).toBe('22');
  });
});

describe('answers', () => {
  it('accepts a full set of answers', () => {
    const a = {
      finalAway: 20, finalHome: 27, firstTeam: 'home', firstScoreType: 'safety', firstTdScorer: '4241389',
      halftime: 'tie', passTds: 'away', rushTds: 'tie', missedKick: true, leadChange4q: false,
      fgs: 3, punts: 8, tds: 6, turnovers: 2, longestTd: 0, sacks: 5,
    };
    expect(answerProblems(a)).toEqual([]);
    expect(answeredCount(a as never)).toBe(15);
  });

  it('accepts skipped questions (they score 0)', () => {
    expect(answerProblems({})).toEqual([]);
    expect(answerProblems({ punts: 7 })).toEqual([]);
  });

  it("rejects a tied final score, half a final score, and out-of-range numbers", () => {
    expect(answerProblems({ finalAway: 21, finalHome: 21 })).toContain("final score can't be a tie");
    expect(answerProblems({ finalAway: 21 })).toContain('final score needs both teams');
    expect(answerProblems({ finalAway: 100, finalHome: 3 })).not.toEqual([]);
    expect(answerProblems({ punts: 2.5 })).not.toEqual([]);
    expect(answerProblems({ sacks: -1 })).not.toEqual([]);
    expect(answerProblems({ longestTd: 110 })).not.toEqual([]);
  });

  it('uses plain-English labels (no raw field keys) and maps each problem to its question card', () => {
    const details = answerProblemDetails({ fgs: 25, longestTd: 120, finalAway: 105, finalHome: 10 });
    expect(details).toEqual([
      {
        question: 'final',
        label: 'Final score',
        inline: 'Enter whole numbers from 0 to 99.',
        message: 'Final score must be a whole number 0–99',
      },
      {
        question: 'fgs',
        label: 'Total field goals made',
        inline: 'Enter a whole number from 0 to 20.',
        message: 'Total field goals made must be a whole number 0–20',
      },
      {
        question: 'longestTd',
        label: 'Yards on the longest TD',
        inline: 'Enter a whole number from 0 to 109.',
        message: 'Yards on the longest TD must be a whole number 0–109',
      },
    ]);
    for (const d of details) {
      expect(d.message).not.toMatch(/\b(finalAway|finalHome|fgs|longestTd)\b/);
    }
  });

  it('groups all 15 questions into 3 non-overlapping sections and tracks answered state', () => {
    const all = QUESTION_SECTIONS.flatMap((s) => [...s.questions]);
    expect(QUESTION_SECTIONS.map((s) => s.title)).toEqual(['Score & Firsts', 'Game Flow', 'Stat Totals']);
    expect(all).toHaveLength(QUESTION_COUNT);
    expect(new Set(all).size).toBe(QUESTION_COUNT);
    expect(isQuestionAnswered({ finalAway: 21 }, 'final')).toBe(false);
    expect(isQuestionAnswered({ finalAway: 21, finalHome: 24 }, 'final')).toBe(true);
    expect(isQuestionAnswered({ punts: 0 }, 'punts')).toBe(true);
  });

  it('rejects unknown answers and bad choices', () => {
    expect(answerProblems({ bonus: 1 })).not.toEqual([]);
    expect(answerProblems({ firstTeam: 'tie' })).not.toEqual([]);
    expect(answerProblems({ firstScoreType: 'xp' })).not.toEqual([]);
    expect(answerProblems({ missedKick: 'yes' })).not.toEqual([]);
    expect(answerProblems({ firstTdScorer: 'Dak' })).not.toEqual([]);
    expect(answerProblems({ firstTdScorer: 'other' })).toEqual([]);
    expect(answerProblems({ firstTdScorer: 'none' })).toEqual([]);
  });

  it('saves the other answers while one has a problem', () => {
    expect(savableAnswers({ punts: 8, finalAway: 21 })).toEqual({ punts: 8 });
    expect(savableAnswers({ punts: 8, finalAway: 21, finalHome: 21 })).toEqual({ punts: 8 });
    expect(savableAnswers({ punts: 99, sacks: 3, finalAway: 20, finalHome: 24 })).toEqual({ sacks: 3, finalAway: 20, finalHome: 24 });
  });

  it('drops blanks when saving', () => {
    expect(compactAnswers({ punts: 5, sacks: undefined, firstTeam: '', fgs: null })).toEqual({ punts: 5 });
  });
});

describe('player names', () => {
  it('are unique ignoring case and extra spaces', () => {
    expect(nameKey('Kyle')).toBe(nameKey('kyle'));
    expect(nameKey('  Aunt   Sue ')).toBe(nameKey('aunt sue'));
    expect(cleanName('  Aunt   Sue ')).toBe('Aunt Sue');
  });

  it('must be 1–20 simple characters', () => {
    expect(nameProblem('')).not.toBeNull();
    expect(nameProblem('   ')).not.toBeNull();
    expect(nameProblem('x'.repeat(21))).not.toBeNull();
    expect(nameProblem('<script>')).not.toBeNull();
    expect(nameProblem("Mary-Kate O'Neil")).toBeNull();
    expect(nameProblem('José 2')).toBeNull();
  });
});

describe('PINs', () => {
  it('are exactly 4 digits', () => {
    expect(isValidPin('0420')).toBe(true);
    expect(isValidPin('420')).toBe(false);
    expect(isValidPin('12345')).toBe(false);
    expect(isValidPin('abcd')).toBe(false);
    expect(isValidPin(1234)).toBe(false);
  });

  it('lock after repeated wrong guesses, doubling up to an hour', () => {
    expect(pinLockMs(FREE_PIN_GUESSES - 1)).toBe(0);
    expect(pinLockMs(FREE_PIN_GUESSES)).toBe(60_000);
    expect(pinLockMs(FREE_PIN_GUESSES + 1)).toBe(120_000);
    expect(pinLockMs(FREE_PIN_GUESSES + 20)).toBe(3_600_000);
  });

  it('make trying all 10,000 PINs take far longer than the contest', () => {
    let total = 0;
    for (let f = 1; f <= 10_000; f++) total += pinLockMs(f);
    expect(total).toBeGreaterThan(365 * 24 * 3_600_000);
  });
});

describe('lock times', () => {
  const now = Date.parse('2026-11-26T17:00:00Z');
  const hour = 3_600_000;

  it('locks at kickoff', () => {
    expect(isLocked(now + 1, now)).toBe(false);
    expect(isLocked(now, now)).toBe(true);
    expect(isLocked(null, now)).toBe(false);
  });

  it('follows the feed before kickoff', () => {
    expect(nextKickoff({ stored: now + hour, feed: now + 2 * hour, override: null, now })).toBe(now + 2 * hour);
    expect(nextKickoff({ stored: null, feed: now + hour, override: null, now })).toBe(now + hour);
  });

  it("uses the admin's time over the feed's", () => {
    expect(nextKickoff({ stored: now + hour, feed: now + 2 * hour, override: now + 3 * hour, now })).toBe(now + 3 * hour);
  });

  it('never reopens a lock: once kickoff has passed, a later time is ignored', () => {
    expect(nextKickoff({ stored: now - 1, feed: now + hour, override: null, now })).toBe(now - 1);
    expect(nextKickoff({ stored: now - 1, feed: now + hour, override: now + hour, now })).toBe(now - 1);
  });
});

describe('reference averages', () => {
  const g = (over: Partial<TeamGameStats>): TeamGameStats => ({
    points: 0, fgs: 0, punts: 0, tds: 0, turnovers: 0, sacks: 0, longestTd: 0, ...over,
  });

  it("are each team's own per-game numbers", () => {
    const { byTeam } = seasonAverages([
      { teamId: '6', stats: g({ punts: 4, points: 24, longestTd: 40 }) },
      { teamId: '6', stats: g({ punts: 5, points: 17, longestTd: 0 }) }, // no TD: counts as 0
      { teamId: '21', stats: g({ punts: 2 }) },
    ]);
    expect(byTeam['6']).toMatchObject({ games: 2, punts: 4.5, points: 20.5, longestTd: 20 });
    expect(byTeam['21']).toMatchObject({ games: 1, punts: 2 });
  });

  it('the NFL average is per team per game', () => {
    const { nfl } = seasonAverages([
      { teamId: '6', stats: g({ sacks: 3 }) },
      { teamId: '21', stats: g({ sacks: 1 }) },
      { teamId: '6', stats: g({ sacks: 2 }) },
    ]);
    expect(nfl).toMatchObject({ games: 3, sacks: 2 });
  });

  it('round to one decimal, and are empty with no games', () => {
    expect(average([g({ fgs: 1 }), g({ fgs: 1 }), g({ fgs: 2 })])!.fgs).toBe(1.3);
    expect(average([])).toBeNull();
  });
});
