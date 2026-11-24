// The page's game tabs and player picker (docs/thanksgiving-spec.md, "Page layout").
import { describe, expect, it } from 'vitest';
import { autoGameId, defaultPickerPlayer, gamePhase, rowPoints, teamLogo } from '../../src/lib/thanksgiving/view';

const KICKOFF = Date.parse('2026-11-26T18:00:00Z');

describe('game phase (the lock icon)', () => {
  it('is open before kickoff, live from kickoff until the game is final, then final', () => {
    expect(gamePhase(KICKOFF, null, KICKOFF - 1)).toBe('open');
    expect(gamePhase(KICKOFF, null, KICKOFF)).toBe('live'); // locked, even before the feed shows it started
    expect(gamePhase(KICKOFF, 'pre', KICKOFF + 1)).toBe('live');
    expect(gamePhase(KICKOFF, 'in', KICKOFF + 1)).toBe('live');
    expect(gamePhase(KICKOFF, 'post', KICKOFF + 1)).toBe('final');
  });

  it('a final-looking result before kickoff still leaves the game open (the lock decides)', () => {
    expect(gamePhase(KICKOFF, 'post', KICKOFF - 1)).toBe('open');
  });
});

describe('the game the page opens on', () => {
  it('is the game being played', () => {
    expect(autoGameId([{ id: 'a', phase: 'final' }, { id: 'b', phase: 'live' }, { id: 'c', phase: 'open' }])).toBe('b');
  });
  it('else the next to kick off', () => {
    expect(autoGameId([{ id: 'a', phase: 'final' }, { id: 'b', phase: 'open' }, { id: 'c', phase: 'open' }])).toBe('b');
  });
  it('else the last game', () => {
    expect(autoGameId([{ id: 'a', phase: 'final' }, { id: 'b', phase: 'final' }])).toBe('b');
    expect(autoGameId([])).toBeNull();
  });
});

describe('player picker', () => {
  const cats: { key: string; points: Record<string, number> }[] = [
    { key: 'finalClosest', points: { a: 3 } },
    { key: 'finalWinner', points: { a: 1, b: 1 } },
    { key: 'finalWithin15', points: { a: 1 } },
    { key: 'punts', points: { b: 3 } },
  ];
  it("adds up a row's points; the final score row is the three final-score categories", () => {
    expect(rowPoints(cats, 'final', 'a')).toBe(5);
    expect(rowPoints(cats, 'final', 'b')).toBe(1);
    expect(rowPoints(cats, 'punts', 'b')).toBe(3);
    expect(rowPoints(cats, 'punts', 'a')).toBe(0);
    expect(rowPoints(cats, 'sacks', 'a')).toBe(0);
  });
  it('starts on you, else the first player', () => {
    expect(defaultPickerPlayer(['a', 'me', 'b'], 'me')).toBe('me');
    expect(defaultPickerPlayer(['a', 'b'], 'me')).toBe('a');
    expect(defaultPickerPlayer(['a', 'b'], null)).toBe('a');
    expect(defaultPickerPlayer([], null)).toBeNull();
  });
});

describe('team logos', () => {
  it("come from ESPN's logo CDN, by abbreviation", () => {
    expect(teamLogo('WSH')).toBe('https://a.espncdn.com/i/teamlogos/nfl/500/wsh.png');
  });
});
