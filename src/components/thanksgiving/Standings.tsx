import { useState } from 'react';
import type { Standings as StandingsData } from '../../lib/thanksgiving/scoring';
import { rankStandings, type Game, type Player } from '../../lib/thanksgiving/view';
import { ChampionBanner, RankMedal } from './Festive';
import { ChevronIcon, LockIcon, TeamLogo } from './icons';

interface Props {
  standings: StandingsData | null;
  games: Game[];
  players: Player[];
  me: Player | null;
  /** Each player's locked points (view.ts, lockedPoints). */
  locked: Record<string, number>;
}

/**
 * Overall standings (docs/thanksgiving-spec.md, "Standings → Overall"): ordered by locked points,
 * with live points (counting what could still change) next to them.
 */
export function Standings({ standings, games, players, me, locked }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const names = new Map(players.map((p) => [p.id, p.name]));
  if (!standings || standings.status === 'pre' || standings.rows.length === 0) {
    return (
      <section className="tg-card" aria-labelledby="tg-standings-title">
        <h2 id="tg-standings-title">Overall standings</h2>
        <p className="muted">Standings start when the first game kicks off.</p>
      </section>
    );
  }
  const projected = standings.status === 'live';
  const byId = new Map(standings.rows.map((r) => [r.playerId, r]));
  const rows = rankStandings(standings.rows.filter((r) => names.has(r.playerId)), locked, standings.status === 'final');
  const champions = standings.champions.map((id) => names.get(id)).filter((n): n is string => Boolean(n));

  return (
    <section className="tg-standings" aria-labelledby="tg-standings-title" data-testid="tg-standings">
      <div className="tg-standings-head">
        <h2 id="tg-standings-title">Overall standings</h2>
        {projected && (
          <span className="tg-live-badge" role="img" aria-label="Live" title="Live">
            <span className="tg-live-pill-dot" aria-hidden="true" />
            Live
          </span>
        )}
      </div>
      {champions.length > 0 && (
        <ChampionBanner
          title={champions.length > 1 ? 'Co-champions' : 'Thanksgiving Champion'}
          names={champions.join(' & ')}
          testId="tg-champion"
        />
      )}
      <div className="tg-board-head" aria-hidden="true">
        <span />
        <span />
        <span className="tg-board-locked"><LockIcon phase="live" size={12} /></span>
        <span>Live</span>
        <span />
      </div>
      <ol className="tg-board">
        {rows.map((r) => {
          const expanded = open === r.playerId;
          const rowClass = [
            r.rank === 1 ? 'tg-board-leader' : '',
            r.playerId === me?.id ? 'tg-me' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <li key={r.playerId} className={rowClass || undefined}>
              <button type="button" className="tg-board-row" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : r.playerId)}>
                <span className="tg-rank"><RankMedal rank={r.rank} size={28} /></span>
                <span className="tg-board-name">{names.get(r.playerId)}{r.playerId === me?.id ? ' (you)' : ''}</span>
                <span className="tg-points tg-board-locked" data-testid={`tg-locked-${names.get(r.playerId)}`} aria-label={`${r.locked} locked`}>{r.locked}</span>
                <span className={projected ? 'tg-points tg-live-points' : 'tg-points'} data-testid={`tg-total-${names.get(r.playerId)}`} aria-label={`${r.live} live`}>{r.live}</span>
                <ChevronIcon open={expanded} />
              </button>
              {expanded && (
                <ul className="tg-board-games">
                  {games.map((g) => (
                    <li key={g.id}>
                      <TeamLogo team={g.away} size={18} />
                      <TeamLogo team={g.home} size={18} />
                      <span>{g.away.abbr} @ {g.home.abbr}</span>
                      <strong>{byId.get(r.playerId)?.byGame[g.id] ?? 0}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
