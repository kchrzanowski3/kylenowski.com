import { useEffect, useState } from 'react';
import { etTime } from '../../lib/thanksgiving/config';
import type { Standings as StandingsData } from '../../lib/thanksgiving/scoring';
import {
  rankStandings,
  type Game,
  type GamePhase,
  type Player,
  type StandingsSort,
} from '../../lib/thanksgiving/view';
import { ChampionBanner, RankMedal } from './Festive';
import { CheckIcon, ChevronIcon, TeamLogo } from './icons';

interface Props {
  standings: StandingsData | null;
  games: Game[];
  phases: { id: string; phase: GamePhase }[];
  players: Player[];
  me: Player | null;
  /** Each player's banked points across all games (view.ts, lockedPoints). */
  locked: Record<string, number>;
  /** Each player's banked points broken down by game (view.ts, lockedPointsByGame). */
  lockedByGame: Record<string, Record<string, number>>;
  /** True when the active game tab is open for picks, so mobile starts collapsed to keep the form above the fold. */
  isPickingOpenGame?: boolean;
}

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 640px)').matches
      : false,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(max-width: 640px)');
    const onChange = () => setMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return mobile;
}

/**
 * Overall standings (docs/thanksgiving-spec.md, "Standings → Overall"): defaults to Live pace during
 * active games with a one-tap toggle to Banked points, and collapses to a single Pts column once all
 * games are final. On mobile while filling out picks for an open game, starts collapsed to a compact
 * summary bar so the pick form stays above the fold.
 */
export function Standings({
  standings,
  games,
  phases,
  players,
  me,
  locked,
  lockedByGame,
  isPickingOpenGame = false,
}: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<StandingsSort>('live');
  const isMobile = useIsMobile();
  const autoCollapse = isMobile && isPickingOpenGame;
  const [collapseOverride, setCollapseOverride] = useState<{ forAuto: boolean; collapsed: boolean } | null>(null);
  const collapsed = collapseOverride && collapseOverride.forAuto === autoCollapse ? collapseOverride.collapsed : autoCollapse;

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
  const final = standings.status === 'final';
  const byId = new Map(standings.rows.map((r) => [r.playerId, r]));
  const phaseOf = new Map(phases.map((p) => [p.id, p.phase]));
  const rows = rankStandings(
    standings.rows.filter((r) => names.has(r.playerId)),
    locked,
    final,
    sortBy,
  );
  const champions = standings.champions.map((id) => names.get(id)).filter((n): n is string => Boolean(n));

  if (collapsed && rows.length > 0) {
    const leader = rows[0];
    const leaderName = names.get(leader.playerId) ?? '';
    const leaderPts = projected && sortBy === 'banked' ? leader.locked : leader.live;
    const tiedLeaders = rows.filter((r) => r.rank === 1).length;
    const meRow = me ? rows.find((r) => r.playerId === me.id) ?? null : null;
    const mePts = meRow ? (projected && sortBy === 'banked' ? meRow.locked : meRow.live) : null;

    return (
      <section className="tg-standings tg-standings-compact" aria-label="Overall standings" data-testid="tg-standings">
        <button
          type="button"
          className="tg-standings-bar"
          aria-expanded="false"
          data-testid="tg-standings-toggle"
          onClick={() => setCollapseOverride({ forAuto: autoCollapse, collapsed: false })}
        >
          <span className="tg-standings-bar-title">
            Standings
            {projected && (
              <span className="tg-live-badge tg-live-badge-compact" role="img" aria-label="Live" title="Live">
                <span className="tg-live-pill-dot" aria-hidden="true" />
                Live
              </span>
            )}
          </span>
          <span className="tg-standings-bar-summary">
            <span>
              #1 {leaderName}
              {tiedLeaders > 1 ? ` +${tiedLeaders - 1}` : ''} ({leaderPts})
            </span>
            {meRow && meRow.rank > 1 && (
              <span className="tg-standings-bar-me">
                · You: #{meRow.rank} ({mePts})
              </span>
            )}
            {meRow && meRow.rank === 1 && <span className="tg-standings-bar-me">· You’re #1</span>}
          </span>
          <span className="tg-standings-bar-action">
            All
            <ChevronIcon open={false} />
          </span>
        </button>
      </section>
    );
  }

  return (
    <section className="tg-standings" aria-labelledby="tg-standings-title" data-testid="tg-standings">
      <div className="tg-standings-head">
        <div className="tg-standings-title-row">
          <h2 id="tg-standings-title">Overall standings</h2>
          {projected && (
            <span className="tg-live-badge" role="img" aria-label="Live" title="Live">
              <span className="tg-live-pill-dot" aria-hidden="true" />
              Live
            </span>
          )}
        </div>
        <div className="tg-standings-controls">
          {projected && (
            <div className="tg-seg" role="group" aria-label="Sort standings by" data-testid="tg-standings-sort">
              <button
                type="button"
                className="tg-seg-btn"
                aria-pressed={sortBy === 'live'}
                onClick={() => setSortBy('live')}
              >
                Live
              </button>
              <button
                type="button"
                className="tg-seg-btn"
                aria-pressed={sortBy === 'banked'}
                onClick={() => setSortBy('banked')}
              >
                Banked
              </button>
            </div>
          )}
          {isMobile && (
            <button
              type="button"
              className="tg-standings-hide"
              aria-expanded="true"
              data-testid="tg-standings-toggle"
              onClick={() => setCollapseOverride({ forAuto: autoCollapse, collapsed: true })}
            >
              Hide
            </button>
          )}
        </div>
      </div>

      {champions.length > 0 && (
        <ChampionBanner
          title={champions.length > 1 ? 'Co-champions' : 'Thanksgiving Champion'}
          names={champions.join(' & ')}
          testId="tg-champion"
        />
      )}

      <div className={final ? 'tg-board-head tg-board-final' : 'tg-board-head'}>
        <span className="tg-board-head-rank">#</span>
        <span className="tg-board-head-player">Player</span>
        {final ? (
          <span className="tg-board-head-pts">Pts</span>
        ) : (
          <>
            <button
              type="button"
              className={sortBy === 'live' ? 'tg-col-sort tg-live-points tg-col-active' : 'tg-col-sort tg-live-points'}
              aria-pressed={sortBy === 'live'}
              onClick={() => setSortBy('live')}
            >
              Live{sortBy === 'live' ? ' ↓' : ''}
            </button>
            <button
              type="button"
              className={sortBy === 'banked' ? 'tg-col-sort tg-board-locked tg-col-active' : 'tg-col-sort tg-board-locked'}
              aria-pressed={sortBy === 'banked'}
              onClick={() => setSortBy('banked')}
            >
              <CheckIcon size={11} /> Banked{sortBy === 'banked' ? ' ↓' : ''}
            </button>
          </>
        )}
        <span aria-hidden="true" />
      </div>

      <ol className={final ? 'tg-board tg-board-final' : 'tg-board'}>
        {rows.map((r) => {
          const expanded = open === r.playerId;
          const playerName = names.get(r.playerId);
          const rowClass = [
            r.rank === 1 ? 'tg-board-leader' : '',
            r.playerId === me?.id ? 'tg-me' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <li key={r.playerId} className={rowClass || undefined}>
              <button
                type="button"
                className={final ? 'tg-board-row tg-board-row-final' : 'tg-board-row'}
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : r.playerId)}
              >
                <span className="tg-rank"><RankMedal rank={r.rank} size={34} /></span>
                <span className="tg-board-name">
                  {playerName}
                  {r.playerId === me?.id ? ' (you)' : ''}
                </span>
                {final ? (
                  <span className="tg-points" data-testid={`tg-total-${playerName}`} aria-label={`${r.live} points`}>
                    {r.live}
                  </span>
                ) : (
                  <>
                    <span
                      className={sortBy === 'live' ? 'tg-points tg-live-points tg-col-active' : 'tg-points tg-live-points tg-col-secondary'}
                      data-testid={`tg-total-${playerName}`}
                      aria-label={`${r.live} live`}
                    >
                      {r.live}
                    </span>
                    <span
                      className={sortBy === 'banked' ? 'tg-points tg-board-locked tg-col-active' : 'tg-points tg-board-locked tg-col-secondary'}
                      data-testid={`tg-locked-${playerName}`}
                      aria-label={`${r.locked} banked`}
                    >
                      {r.locked}
                    </span>
                  </>
                )}
                <ChevronIcon open={expanded} />
              </button>
              {expanded && (
                <ul className="tg-board-games">
                  {games.map((g) => {
                    const phase = phaseOf.get(g.id) ?? 'open';
                    const unstarted = phase === 'open';
                    const gameLive = byId.get(r.playerId)?.byGame[g.id] ?? 0;
                    const gameBanked = phase === 'final' ? gameLive : (lockedByGame[g.id]?.[r.playerId] ?? 0);
                    return (
                      <li key={g.id} className={final ? 'tg-board-game tg-board-game-final' : 'tg-board-game'}>
                        <span className="tg-board-game-info">
                          <TeamLogo team={g.away} size={18} />
                          <TeamLogo team={g.home} size={18} />
                          <span>
                            {g.away.abbr} @ {g.home.abbr}
                          </span>
                          {unstarted && <span className="tg-board-game-kickoff">{etTime(g.kickoff)}</span>}
                        </span>
                        {final ? (
                          <strong className={unstarted ? 'tg-board-game-pts muted' : 'tg-board-game-pts'}>
                            {unstarted ? '—' : gameLive}
                          </strong>
                        ) : (
                          <>
                            <strong className={unstarted ? 'tg-board-game-pts muted' : 'tg-board-game-pts tg-live-points'}>
                              {unstarted ? '—' : gameLive}
                            </strong>
                            <strong className={unstarted ? 'tg-board-game-pts muted' : 'tg-board-game-pts tg-board-locked'}>
                              {unstarted ? '—' : gameBanked}
                            </strong>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
