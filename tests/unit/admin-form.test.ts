// How the admin screen turns what's typed into override values (src/components/thanksgiving/admin).
import { describe, expect, it } from 'vitest';
import { parseOverride } from '../../src/components/thanksgiving/admin/AdminGame';
import { overrideProblem } from '../../functions/src/admin';

describe('parseOverride', () => {
  it('numbers, yes/no, game state and JSON values', () => {
    expect(parseOverride('punts', ' 7 ')).toBe(7);
    expect(parseOverride('missedKick', 'yes')).toBe(true);
    expect(parseOverride('leadChange4q', 'no')).toBe(false);
    expect(parseOverride('state', 'post')).toBe('post');
    expect(parseOverride('firstScore', '{"side":"home","type":"safety"}')).toEqual({ side: 'home', type: 'safety' });
    expect(() => parseOverride('halftime', '10-14')).toThrow();
  });

  it('produces values the admin service accepts', () => {
    expect(overrideProblem('punts', parseOverride('punts', '7'))).toBeNull();
    expect(overrideProblem('halftime', parseOverride('halftime', '{"away":10,"home":14}'))).toBeNull();
    expect(overrideProblem('punts', parseOverride('punts', 'seven'))).not.toBeNull(); // NaN is refused
  });
});
