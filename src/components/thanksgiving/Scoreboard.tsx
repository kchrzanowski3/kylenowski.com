import { useState, type ReactNode } from 'react';
import type { CategoryResult, GameScore } from '../../lib/thanksgiving/scoring';
import type { GameStats } from '../../lib/thanksgiving/stats';
import { CATEGORY_SHORT, whoCount, worthBadge, type Game, type Player } from '../../lib/thanksgiving/view';

export interface GameResult {
  stats: GameStats;
  score: GameScore;
}

/** "Q3 5:00", "Halftime", "Final", "Final/OT". */
export function gameClock(s: GameStats): string {
  if (s.state === 'pre') return 'Not started';
  if (s.state === 'post') return s.period > 4 ? 'Final/OT' : 'Final';
  if (s.halftimeReached && s.period <= 2) return 'Halftime';
  const q = s.period > 4 ? 'OT' : `Q${s.period}`;
  return s.clock ? `${q} ${s.clock}` : q;
}

interface Props {
  game: Game;
  result: GameResult | null;
  players: Player[];
  me: Player | null;
  /** The player picker, between the score and the categories. */
  children?: ReactNode;
}

/** Per-game scoreboard (docs/thanksgiving-spec.md, "Standings → Per-game scoreboard" and "Page layout"). The score
 * itself is in the game's header (GamePanel). */
export function Scoreboard({ game, result, players, me, children }: Props) {
  if (!result || result.score.status === 'pre') {
    return (
      <>
        <p className="muted">The scoreboard starts when the feed shows the game under way.</p>
        {children}
      </>
    );
  }
  const { score } = result;
  const names = new Map(players.map((p) => [p.id, p.name]));
  const who = (ids: string[]) => ids.map((id) => names.get(id)).filter(Boolean).join(', ') || '—';

  return (
    <div className="tg-scoreboard" data-testid="tg-scoreboard">
      {score.winners.length > 0 && (
        <p className="tg-champion">🏆 Game winner{score.winners.length > 1 ? 's' : ''}: {who(score.winners)}</p>
      )}
      {children}
      <section aria-labelledby={`tg-cats-${game.id}`}>
        <h3 id={`tg-cats-${game.id}`} className="tg-cats-title">Who's getting points this game</h3>
        <ul className="tg-cats">
          {score.categories.map((c) => (
            <CategoryRow key={c.key} c={c} names={names} meId={me?.id ?? null} />
          ))}
        </ul>
      </section>
    </div>
  );
}

/** One category: short name, worth, current value, who's right (a count) and a final/live mark. Tap for details. */
function CategoryRow({ c, names, meId }: { c: CategoryResult; names: Map<string, string>; meId: string | null }) {
  const [open, setOpen] = useState(false);
  const right = Object.keys(c.points).filter((id) => names.has(id));
  const mine = meId !== null && right.includes(meId);
  const final = c.status === 'final';
  return (
    <li className={mine ? 'tg-cat tg-cat-mine' : 'tg-cat'} data-testid={`tg-cat-${c.key}`}>
      <button type="button" className="tg-cat-row" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="tg-cat-name">
          <span className="tg-cat-label">
            {CATEGORY_SHORT[c.key]} <span className="tg-worth" aria-label={`worth ${c.worth}`}>{worthBadge(c.worth)}</span>
          </span>
          <span className="tg-cat-value">{c.answer}</span>
        </span>
        <span className={final ? 'tg-cat-who' : 'tg-cat-who tg-projected'}>{whoCount(right, names, meId)}</span>
        {final ? (
          <svg className="tg-mark tg-mark-final" width="16" height="16" viewBox="0 0 24 24" role="img" aria-label="Final">
            <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg className="tg-mark tg-mark-live" width="16" height="16" viewBox="0 0 24 24" role="img" aria-label="Could still change">
            <circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" strokeWidth="2.6" />
          </svg>
        )}
      </button>
      {open && (
        <dl className="tg-cat-details">
          <dt>Category</dt>
          <dd>{c.label}</dd>
          <dt>Worth</dt>
          <dd>{c.worth}</dd>
          <dt>So far</dt>
          <dd>{c.answer}</dd>
          <dt>Who's right</dt>
          <dd>{right.length ? right.map((id) => (id === meId ? `${names.get(id)} (you)` : names.get(id))).join(', ') : '—'}</dd>
          <dt>Status</dt>
          <dd>{final ? 'Final' : 'Could still change'}</dd>
        </dl>
      )}
    </li>
  );
}
