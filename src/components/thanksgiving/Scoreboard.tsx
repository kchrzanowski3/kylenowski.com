import type { ReactNode } from 'react';
import type { GameScore } from '../../lib/thanksgiving/scoring';
import type { GameStats } from '../../lib/thanksgiving/stats';
import type { Game, Player } from '../../lib/thanksgiving/view';
import { TeamLogo } from './icons';

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

/** Per-game scoreboard (docs/thanksgiving-spec.md, "Standings → Per-game scoreboard"). */
/** `children` (the player picker) goes between the score and the categories table. */
export function Scoreboard({ game, result, players, children }: { game: Game; result: GameResult | null; players: Player[]; children?: ReactNode }) {
  if (!result || result.score.status === 'pre') {
    return (
      <>
        <p className="muted">The scoreboard starts when the feed shows the game under way.</p>
        {children}
      </>
    );
  }
  const { stats, score } = result;
  const names = new Map(players.map((p) => [p.id, p.name]));
  const who = (ids: string[]) => ids.map((id) => names.get(id)).filter(Boolean).join(', ') || '—';
  const live = score.status === 'live';

  return (
    <div className="tg-scoreboard" data-testid="tg-scoreboard">
      <p className="tg-livescore" data-testid="tg-livescore">
        <span className="tg-livescore-team"><TeamLogo team={game.away} size={32} /> {game.away.abbr} <strong>{stats.away}</strong></span>
        <span className="muted">–</span>
        <span className="tg-livescore-team"><strong>{stats.home}</strong> {game.home.abbr} <TeamLogo team={game.home} size={32} /></span>
        <span className={live ? 'tg-clock tg-clock-live' : 'tg-clock'}>{gameClock(stats)}</span>
      </p>
      {score.winners.length > 0 && (
        <p className="tg-champion">🏆 Game winner{score.winners.length > 1 ? 's' : ''}: {who(score.winners)}</p>
      )}
      {children}
      <div className="tg-reveal-wrap">
        <table className="tg-reveal tg-categories">
          <caption>Who's getting points</caption>
          <thead>
            <tr>
              <th scope="col">Category</th>
              <th scope="col">Worth</th>
              <th scope="col">So far</th>
              <th scope="col">Who's right</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {score.categories.map((c) => (
              <tr key={c.key}>
                <th scope="row">{c.label}</th>
                <td>{c.worth}</td>
                <td>{c.answer}</td>
                <td className={c.status === 'live' ? 'tg-projected' : undefined}>{who(Object.keys(c.points))}</td>
                <td><span className={`tg-badge tg-badge-${c.status}`}>{c.status === 'final' ? 'Final' : 'Live'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
