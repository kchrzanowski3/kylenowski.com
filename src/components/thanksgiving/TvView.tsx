// The full-screen scoreboard (docs/thanksgiving-spec.md, "Full-screen scoreboard"): for a computer or
// a TV left on during the games. Everything is shown, nothing tucked away: the game's score and every
// scoring category with who's right, and the overall standings at the side. It follows the live game
// and keeps the screen awake.
import { useEffect, useRef, useState } from 'react';
import type { Standings as StandingsData } from '../../lib/thanksgiving/scoring';
import { formatPoints } from '../../lib/thanksgiving/projection';
import { etDateTime } from '../../lib/thanksgiving/config';
import { autoGameId, rankStandings, worthBadge, type Game, type GamePhase, type Player } from '../../lib/thanksgiving/view';
import { LockIcon, TeamLogo } from './icons';
import { gameClock, type GameResult } from './Scoreboard';

interface Props {
  games: Game[];
  phases: { id: string; phase: GamePhase }[];
  results: Record<string, GameResult>;
  standings: StandingsData | null;
  locked: Record<string, number>;
  players: Player[];
  onExit: () => void;
}

/** Keeps the screen from sleeping while the scoreboard is up (where the browser supports it). */
function useWakeLock() {
  useEffect(() => {
    type Sentinel = { release(): Promise<void> };
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<Sentinel> } };
    if (!nav.wakeLock) return;
    let lock: Sentinel | null = null;
    let done = false;
    const take = () => {
      if (done || document.visibilityState !== 'visible') return;
      nav.wakeLock!.request('screen').then((l) => (done ? void l.release() : (lock = l)), () => {});
    };
    take();
    document.addEventListener('visibilitychange', take); // the lock is dropped when the tab is hidden
    return () => {
      done = true;
      document.removeEventListener('visibilitychange', take);
      void lock?.release().catch(() => {});
    };
  }, []);
}

export function TvView({ games, phases, results, standings, locked, players, onExit }: Props) {
  const root = useRef<HTMLDivElement>(null);
  useWakeLock();

  // Full screen when the browser allows it; leaving full screen (Esc) closes the scoreboard.
  useEffect(() => {
    const el = root.current;
    let entered = false;
    const onChange = () => {
      if (document.fullscreenElement) entered = true;
      else if (entered) onExit();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.fullscreenElement && onExit();
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('keydown', onKey);
    el?.requestFullscreen?.().catch(() => {}); // e.g. iPhone: the scoreboard still fills the window
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, [onExit]);

  // Follow the live game; a game you pick stays until the game being followed changes.
  const auto = autoGameId(phases);
  const [chosen, setChosen] = useState<{ id: string; autoAt: string | null } | null>(null);
  const activeId = chosen && chosen.autoAt === auto && games.some((g) => g.id === chosen.id) ? chosen.id : auto;
  const game = games.find((g) => g.id === activeId) ?? null;
  const phaseOf = new Map(phases.map((p) => [p.id, p.phase]));
  const names = new Map(players.map((p) => [p.id, p.name]));

  return (
    <div className="tg-tv" ref={root} role="dialog" aria-label="Full-screen scoreboard" data-testid="tg-tv">
      <header className="tg-tv-top">
        <nav className="tg-tv-games" aria-label="Scoreboard games">
          {games.map((g) => (
            <button
              key={g.id}
              type="button"
              className="tg-tv-tab"
              aria-current={g.id === activeId ? 'page' : undefined}
              onClick={() => setChosen({ id: g.id, autoAt: auto })}
            >
              <TeamLogo team={g.away} size={22} />
              {g.away.abbr} @ {g.home.abbr}
              <TeamLogo team={g.home} size={22} />
              <LockIcon phase={phaseOf.get(g.id) ?? 'open'} size={13} />
            </button>
          ))}
        </nav>
        <button type="button" className="tg-tv-exit" onClick={onExit}>Exit full screen</button>
      </header>

      <div className="tg-tv-body">
        <section className="tg-tv-game" aria-label="Game">
          {game && <TvGame game={game} phase={phaseOf.get(game.id) ?? 'open'} result={results[game.id] ?? null} names={names} />}
        </section>
        <aside className="tg-tv-standings" aria-labelledby="tg-tv-standings-title">
          <h2 id="tg-tv-standings-title">
            Overall standings{standings?.status === 'live' && <span className="tg-live-dot" role="img" aria-label="Live" />}
          </h2>
          {standings && standings.status !== 'pre' ? (
            <table className="tg-tv-table" data-testid="tg-tv-standings">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Player</th>
                  <th scope="col" className="tg-num"><LockIcon phase="live" size={13} /> Locked</th>
                  <th scope="col" className="tg-num">Live</th>
                </tr>
              </thead>
              <tbody>
                {rankStandings(standings.rows.filter((r) => names.has(r.playerId)), locked, standings.status === 'final').map((r) => (
                  <tr key={r.playerId}>
                    <td className="tg-rank">{r.rank}</td>
                    <td>{names.get(r.playerId)}</td>
                    <td className="tg-num tg-board-locked">{r.locked}</td>
                    <td className="tg-num tg-live-points">{r.live}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">Standings start when the first game kicks off.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

function TvGame({ game, phase, result, names }: { game: Game; phase: GamePhase; result: GameResult | null; names: Map<string, string> }) {
  const scored = phase !== 'open' && !!result && result.score.status !== 'pre';
  const { line, projection } = game;
  return (
    <>
      <h2 className="tg-tv-matchup" data-testid="tg-tv-matchup">
        <span className="tg-matchup-team"><TeamLogo team={game.away} size={56} /> {game.away.shortName}</span>
        {scored ? (
          <span className="tg-matchup-score">{result!.stats.away} <span className="muted">–</span> {result!.stats.home}</span>
        ) : (
          <span className="muted">@</span>
        )}
        <span className="tg-matchup-team">{game.home.shortName} <TeamLogo team={game.home} size={56} /></span>
      </h2>
      <p className="tg-tv-sub">
        {scored ? (
          <span className={phase === 'live' ? 'tg-clock tg-clock-live' : 'tg-clock'}>{gameClock(result!.stats)}</span>
        ) : (
          <span className="muted">
            {phase === 'open' ? `Kicks off ${etDateTime(game.kickoff)}` : 'Starting soon'}
            {game.tv ? ` · ${game.tv}` : ''}
            {line && projection
              ? ` · Vegas projects ${game.away.abbr} ${formatPoints(projection.away)} – ${game.home.abbr} ${formatPoints(projection.home)}`
              : ''}
          </span>
        )}
      </p>

      {scored && (
        <table className="tg-tv-table tg-tv-cats" data-testid="tg-tv-categories">
          <thead>
            <tr>
              <th scope="col">Category</th>
              <th scope="col" className="tg-num">Worth</th>
              <th scope="col">So far</th>
              <th scope="col">Who's right</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {result!.score.categories.map((c) => {
              const right = Object.keys(c.points).filter((id) => names.has(id)).map((id) => names.get(id)!);
              const final = c.status === 'final';
              return (
                <tr key={c.key} data-testid={`tg-tv-cat-${c.key}`}>
                  <th scope="row">{c.label}</th>
                  <td className="tg-num">{worthBadge(c.worth)}</td>
                  <td>{c.answer}</td>
                  <td className={final ? undefined : 'tg-projected'}>{right.length ? right.join(', ') : '—'}</td>
                  <td className={final ? 'tg-tv-final' : 'tg-tv-live'}>{final ? '✓ Final' : '○ Live'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
