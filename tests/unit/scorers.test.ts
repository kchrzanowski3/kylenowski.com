// First-TD-scorer list (docs/thanksgiving-spec.md, scoring rules and Testing §5).
import { describe, expect, it } from 'vitest';
import { applyScorerEdits, buildScorerOptions, parseRoster, scorerPickCounts } from '../../src/lib/thanksgiving/scorers';
import type { ScorerOption } from '../../src/lib/thanksgiving/types';
import { load } from './fixtures';

const chart = load('depthchart-dal.json');
const roster = parseRoster(load('roster-dal.json'));

describe('buildScorerOptions (Cowboys, recorded depth chart)', () => {
  const list = buildScorerOptions(chart, roster, 'home');
  const names = (pos: string) => list.filter((p) => p.pos === pos).map((p) => p.name);

  it('has the top 2 QBs and top 2 RBs', () => {
    expect(names('QB')).toEqual(['Dak Prescott', 'Sam Howell']);
    expect(names('RB')).toEqual(['Javonte Williams', 'Jashaun Corbin']);
  });

  it('has the 3 starting WRs, one per WR slot', () => {
    expect(names('WR')).toEqual(['CeeDee Lamb', 'George Pickens', 'Ryan Flournoy']);
  });

  it('drops a starter ruled out (Jake Ferguson, TE1, is Out) and uses the next TE', () => {
    expect(names('TE')).toEqual(['Brevyn Spann-Ford']);
    expect(list.some((p) => p.name === 'Jake Ferguson')).toBe(false);
  });

  it('has 8 players, all tagged with the team side', () => {
    expect(list).toHaveLength(8);
    expect(list.every((p) => p.side === 'home')).toBe(true);
  });

  it('fills a WR slot from the next WR when a starter is ruled out', () => {
    const lambOut = roster.map((p) => (p.name === 'CeeDee Lamb' ? { ...p, available: false } : p));
    const wrs = buildScorerOptions(chart, lambOut, 'home').filter((p) => p.pos === 'WR').map((p) => p.name);
    expect(wrs.sort()).toEqual(['George Pickens', 'KaVontae Turpin', 'Ryan Flournoy']);
  });

  it('marks injured-reserve and ruled-out players unavailable, but keeps questionable ones', () => {
    const byName = new Map(roster.map((p) => [p.name, p]));
    expect(byName.get('Tyler Goodson')?.available).toBe(false); // Injured Reserve
    expect(byName.get('Jonathan Mingo')?.available).toBe(false); // Out
    expect(byName.get('Dee Winters')?.available).toBe(true); // Questionable
  });
});

describe('admin edits to the list', () => {
  const base: ScorerOption[] = [
    { id: '1', name: 'A', pos: 'QB', side: 'away' },
    { id: '2', name: 'B', pos: 'WR', side: 'away' },
  ];
  const added: ScorerOption = { id: '3', name: 'C', pos: 'TE', side: 'away' };

  it('removes and adds players, and survives a rebuilt list', () => {
    const edits = { added: [added], removed: ['2'] };
    expect(applyScorerEdits(base, edits).map((p) => p.id)).toEqual(['1', '3']);
    // The next refresh rebuilds the list from the feed; the edits are applied again on top.
    const rebuilt = [...base, { id: '4', name: 'D', pos: 'RB' as const, side: 'away' as const }];
    expect(applyScorerEdits(rebuilt, edits).map((p) => p.id)).toEqual(['1', '4', '3']);
  });

  it("doesn't duplicate a player the feed also lists", () => {
    expect(applyScorerEdits(base, { added: [base[0]], removed: [] })).toHaveLength(2);
  });
});

describe('scorerPickCounts', () => {
  const list: ScorerOption[] = [{ id: '1', name: 'A', pos: 'QB', side: 'away' }];
  it('a pick on a player dropped from the list stays but does not score', () => {
    expect(scorerPickCounts('1', list)).toBe(true);
    expect(scorerPickCounts('99', list)).toBe(false);
  });
  it('"Other player" and "No TD" always count', () => {
    expect(scorerPickCounts('other', [])).toBe(true);
    expect(scorerPickCounts('none', [])).toBe(true);
  });
});
