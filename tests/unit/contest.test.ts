// The contest and its practice games (docs/thanksgiving-spec.md, "Games" and "Practice games").
import { describe, expect, it } from 'vitest';
import {
  CONTEST_DATE,
  CONTEST_DAY_ET,
  CUTOVER_MS,
  PRACTICE_CONTEST,
  THANKSGIVING_CONTEST,
  col,
  contestAt,
  etDateTime,
} from '../../src/lib/thanksgiving/config';

const TESTS = ['Test1', 'Test2', 'Test3', 'Test4', 'Test5', 'Test6', 'Test7', 'Test8', 'Test9', 'Test10'];

describe('the contest', () => {
  it('from Thursday morning is Thursday, Nov 26 only, on the tg* collections, and retires the practice players', () => {
    expect(THANKSGIVING_CONTEST).toEqual({
      dates: ['20261126'],
      daysEt: ['2026-11-26'],
      prefix: 'tg',
      seedPlayers: [],
      seedPickDays: [],
      retiredPlayers: TESTS,
    });
    expect([CONTEST_DATE, CONTEST_DAY_ET]).toEqual(['20261126', '2026-11-26']);
    expect(col(THANKSGIVING_CONTEST, 'Games')).toBe('tgGames');
  });

  it('until then also has the Mon Nov 23 and Wed Nov 25 games, and Test1-Test10 with picks for those days', () => {
    expect(PRACTICE_CONTEST).toEqual({
      dates: ['20261123', '20261125', '20261126'],
      daysEt: ['2026-11-23', '2026-11-25', '2026-11-26'],
      prefix: 'tg',
      seedPlayers: TESTS,
      seedPickDays: ['2026-11-23', '2026-11-25'],
      retiredPlayers: [],
    });
  });

  it('switches at 6:00 AM ET Thursday', () => {
    expect(etDateTime(CUTOVER_MS)).toBe('Thu, Nov 26, 6:00 AM ET');
    expect(contestAt(CUTOVER_MS - 1)).toBe(PRACTICE_CONTEST);
    expect(contestAt(CUTOVER_MS)).toBe(THANKSGIVING_CONTEST);
    // Wednesday night's practice game (and its live worker, until 1:00 AM) is still in the practice.
    expect(contestAt(Date.parse('2026-11-26T05:59:00Z'))).toBe(PRACTICE_CONTEST);
  });
});
