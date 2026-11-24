// The practice players' seed picks (docs/thanksgiving-spec.md, "Practice games").
import { describe, expect, it } from 'vitest';
import { QUESTION_COUNT, answerProblems, answeredCount } from '../../src/lib/thanksgiving/questions';
import { seedAnswers } from '../../src/lib/thanksgiving/seed-picks';

const SCORERS = [
  { id: '101', name: 'A', pos: 'QB' as const, side: 'away' as const },
  { id: '201', name: 'B', pos: 'RB' as const, side: 'home' as const },
];

describe('seed picks', () => {
  it('answer all 15 questions with valid answers, for every seed player and game', () => {
    for (let n = 1; n <= 10; n++) {
      for (const game of ['401873081', '401873082', 'g1']) {
        const a = seedAnswers(`Test${n}`, game, SCORERS);
        expect(answerProblems(a as Record<string, unknown>)).toEqual([]);
        expect(answeredCount(a)).toBe(QUESTION_COUNT);
        expect(['101', '201', 'other', 'none']).toContain(a.firstTdScorer);
      }
    }
  });

  it('are stable per player and game, and differ between players', () => {
    expect(seedAnswers('Test1', 'g1', SCORERS)).toEqual(seedAnswers('Test1', 'g1', SCORERS));
    const all = Array.from({ length: 10 }, (_, i) => JSON.stringify(seedAnswers(`Test${i + 1}`, 'g1', SCORERS)));
    expect(new Set(all).size).toBe(10);
  });

  it('work for a game without a scorer list', () => {
    expect(['other', 'none']).toContain(seedAnswers('Test1', 'g1', []).firstTdScorer);
  });
});
