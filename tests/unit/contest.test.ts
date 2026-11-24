// Contests (docs/thanksgiving-spec.md, "Games" and "Test contest"): the real contest is exactly the
// Thanksgiving setup it always was; the test contest has its own dates and collections.
import { describe, expect, it } from 'vitest';
import { contestQuery } from '../../src/lib/thanksgiving/client';
import {
  CONTEST_DATE,
  CONTEST_DAY_ET,
  REAL_CONTEST,
  TEST_CONTEST,
  col,
  contestById,
  type CollectionName,
} from '../../src/lib/thanksgiving/config';

const COLLECTIONS: CollectionName[] = [
  'Games', 'Players', 'Secrets', 'Names', 'Live', 'Overrides', 'Results', 'Standings', 'Meta', 'AdminLog', 'SeasonGames',
];

describe('the real contest', () => {
  it('is Thursday, Nov 26 only, on the tg* collections, with no seed players', () => {
    expect(REAL_CONTEST).toEqual({
      id: 'thanksgiving',
      dates: ['20261126'],
      daysEt: ['2026-11-26'],
      prefix: 'tg',
      path: '/thanksgiving',
      seedPlayers: [],
    });
    expect(CONTEST_DATE).toBe('20261126');
    expect(CONTEST_DAY_ET).toBe('2026-11-26');
  });

  it('keeps its collection names', () => {
    expect(COLLECTIONS.map((c) => col(REAL_CONTEST, c))).toEqual([
      'tgGames', 'tgPlayers', 'tgSecrets', 'tgNames', 'tgLive', 'tgOverrides', 'tgResults', 'tgStandings', 'tgMeta',
      'tgAdminLog', 'tgSeasonGames',
    ]);
  });

  it('is what a request or page without a contest gets, and its calls carry no ?contest=', () => {
    for (const id of [undefined, null, '', 'thanksgiving']) expect(contestById(id)).toBe(REAL_CONTEST);
    expect(contestQuery(REAL_CONTEST)).toBe('');
  });
});

describe('the test contest', () => {
  it('is Mon Nov 23 and Wed Nov 25, on tgTest* collections, with players Test1-Test10', () => {
    expect(TEST_CONTEST).toMatchObject({
      id: 'test',
      dates: ['20261123', '20261125'],
      daysEt: ['2026-11-23', '2026-11-25'],
      prefix: 'tgTest',
      path: '/thanksgiving-test',
    });
    expect(TEST_CONTEST.seedPlayers).toEqual(['Test1', 'Test2', 'Test3', 'Test4', 'Test5', 'Test6', 'Test7', 'Test8', 'Test9', 'Test10']);
    expect(contestById('test')).toBe(TEST_CONTEST);
    expect(contestQuery(TEST_CONTEST)).toBe('?contest=test');
  });

  it('shares no collection with the real contest', () => {
    const real = new Set(COLLECTIONS.map((c) => col(REAL_CONTEST, c)));
    const test = COLLECTIONS.map((c) => col(TEST_CONTEST, c));
    expect(test.every((c) => c.startsWith('tgTest'))).toBe(true);
    expect(test.filter((c) => real.has(c))).toEqual([]);
  });

  it('an unknown contest is refused rather than falling back to the real one', () => {
    for (const id of ['tgTest', 'TEST', 'real', 3, {}]) expect(contestById(id)).toBeNull();
  });
});
