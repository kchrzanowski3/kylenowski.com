import { useState } from 'react';
import type { Standings as StandingsData } from '../../lib/thanksgiving/scoring';
import type { Game, Player } from '../../lib/thanksgiving/view';

interface Props {
  standings: StandingsData | null;
  games: Game[];
  players: Player[];
  me: Player | null;
}

/** Overall standings (docs/thanksgiving-spec.md, "Standings → Overall"). */
export function Standings({ standings, games, players, me }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const names = new Map(players.map((p) => [p.id, p.name]));
  // The tiebreaker is the last game's final score (docs/thanksgiving-spec.md): game 3 on Thanksgiving.
  const lastGame = `game ${games.length}`;
  if (!standings || standings.status === 'pre' || standings.rows.length === 0) {
    return (
      <section className="tg-card" aria-labelledby="tg-standings-title">
        <h2 id="tg-standings-title">Standings</h2>
        <p className="muted">Standings start when the first game kicks off.</p>
      </section>
    );
  }
  const rows = standings.rows.filter((r) => names.has(r.playerId));
  const projected = standings.status === 'live';
  const champions = standings.champions.map((id) => names.get(id)).filter(Boolean);
  const tiedAtTop = rows.filter((r) => r.rank === 1).length > 1;

  return (
    <section className="tg-standings" aria-labelledby="tg-standings-title" data-testid="tg-standings">
      <h2 id="tg-standings-title">Standings</h2>
      {champions.length > 0 && (
        <p className="tg-champion" data-testid="tg-champion">
          🏆 {champions.length > 1 ? `Co-champions: ${champions.join(' & ')}` : `Champion: ${champions[0]}`}
        </p>
      )}
      {projected && <p className="tg-projected-note">Projected: points as if the games ended right now.</p>}
      <ol className="tg-board">
        {rows.map((r) => {
          const expanded = open === r.playerId;
          return (
            <li key={r.playerId} className={r.playerId === me?.id ? 'tg-me' : undefined}>
              <button type="button" className="tg-board-row" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : r.playerId)}>
                <span className="tg-rank">{r.rank}</span>
                <span className="tg-board-name">{names.get(r.playerId)}{r.playerId === me?.id ? ' (you)' : ''}</span>
                <span className={projected ? 'tg-points tg-projected' : 'tg-points'} data-testid={`tg-total-${names.get(r.playerId)}`}>{r.total}</span>
              </button>
              {expanded && (
                <ul className="tg-board-games">
                  {games.map((g) => (
                    <li key={g.id}>
                      {g.away.abbr} @ {g.home.abbr}: <strong>{r.byGame[g.id] ?? 0}</strong>
                    </li>
                  ))}
                  {r.tiebreak !== null && <li className="muted">Tiebreaker: {lastGame} total points off by {r.tiebreak}</li>}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
      <p className="muted tg-small">
        Ties for first are broken by whose {lastGame} final-score guess (both teams added) is closest to that game's total
        points{tiedAtTop ? '; if that is tied too, they are co-champions' : ''}. Tap a name for points per game.
      </p>
    </section>
  );
}
