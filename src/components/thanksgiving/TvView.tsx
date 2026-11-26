// The full-screen scoreboard (docs/thanksgiving-spec.md, "Full-screen scoreboard"): for a computer or
// a TV left on during the games. Everything is shown, nothing tucked away: the game's score and every
// scoring category with who's right, and the overall standings at the side. It follows the live game
// and keeps the screen awake.
import { useEffect, useRef, useState } from 'react';
import type { GameAlert } from '../../lib/thanksgiving/alerts';
import type { CategoryKey, Standings as StandingsData } from '../../lib/thanksgiving/scoring';
import { alertChimeKind, playChime } from '../../lib/thanksgiving/sound';
import { formatPoints } from '../../lib/thanksgiving/projection';
import { etDateTime } from '../../lib/thanksgiving/config';
import {
  autoGameId,
  rankStandings,
  worthBadge,
  type Game,
  type GamePhase,
  type Player,
  type StandingsSort,
} from '../../lib/thanksgiving/view';
import { TvPlayStrip } from './Alerts';
import { ChampionBanner, RankMedal } from './Festive';
import { CheckIcon, LiveCircleIcon, PhaseBadge, SoundIcon, TeamLogo, TeamText } from './icons';
import { gameClock, type GameResult } from './Scoreboard';

interface Props {
  games: Game[];
  phases: { id: string; phase: GamePhase }[];
  results: Record<string, GameResult>;
  standings: StandingsData | null;
  locked: Record<string, number>;
  players: Player[];
  playAlerts?: Record<string, GameAlert>;
  categoryFlashes?: Record<string, Partial<Record<CategoryKey, 'final' | 'live'>>>;
  rankUpIds?: readonly string[];
  latestAlert?: GameAlert | null;
  demoMode?: boolean;
  demoNextLabel?: string;
  onDemoAlert?: (gameId: string | null) => void;
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

export function TvView({
  games,
  phases,
  results,
  standings,
  locked,
  players,
  playAlerts = {},
  categoryFlashes = {},
  rankUpIds = [],
  latestAlert = null,
  demoMode = false,
  demoNextLabel,
  onDemoAlert,
  onExit,
}: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [sortBy, setSortBy] = useState<StandingsSort>('live');
  const [soundOn, setSoundOn] = useState(false);
  const [turduckenMode, setTurduckenMode] = useState(false);
  const lastChimedId = useRef<string | null>(latestAlert?.id ?? null);
  useWakeLock();

  // Play a loud broadcast fanfare (when unmuted) on every TV play alert.
  useEffect(() => {
    if (!latestAlert || latestAlert.id === lastChimedId.current) return;
    lastChimedId.current = latestAlert.id;
    if (!soundOn) return;
    playChime(alertChimeKind(latestAlert), { turducken: turduckenMode });
  }, [latestAlert, soundOn, turduckenMode]);

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
  const champions = (standings?.champions ?? []).map((id) => names.get(id)).filter((n): n is string => Boolean(n));
  const finalStandings = standings?.status === 'final';
  const rankUpSet = new Set(rankUpIds);

  const toggleSound = () => {
    setSoundOn((prev) => {
      const next = !prev;
      if (next) playChime('confirm', { turducken: turduckenMode });
      return next;
    });
  };

  const toggleTurducken = () => {
    setTurduckenMode((prev) => {
      const next = !prev;
      if (next) playChime('confirm', { turducken: true });
      return next;
    });
  };

  return (
    <div className="tg-tv" ref={root} role="dialog" aria-label="Full-screen scoreboard" data-testid="tg-tv">
      <header className="tg-tv-top">
        <nav className="tg-tv-games" aria-label="Scoreboard games">
          {games.map((g) => {
            const gPhase = phaseOf.get(g.id) ?? 'open';
            const gStats = gPhase !== 'open' && results[g.id]?.stats && results[g.id].stats.state !== 'pre' ? results[g.id].stats : null;
            return (
              <button
                key={g.id}
                type="button"
                className={`tg-tv-tab tg-tv-tab-${gPhase}`}
                aria-current={g.id === activeId ? 'page' : undefined}
                onClick={() => setChosen({ id: g.id, autoAt: auto })}
              >
                <TeamLogo team={g.away} size={26} standIn />
                <span className="tg-tv-tab-label">
                  {gStats ? `${g.away.abbr} ${gStats.away} – ${gStats.home} ${g.home.abbr}` : `${g.away.abbr} @ ${g.home.abbr}`}
                </span>
                <TeamLogo team={g.home} size={26} standIn />
                <PhaseBadge phase={gPhase} compact />
              </button>
            );
          })}
        </nav>
        <div className="tg-tv-actions">
          {demoMode && onDemoAlert && (
            <button
              type="button"
              className="tg-tv-control tg-tv-demo-btn"
              onClick={() => onDemoAlert(activeId)}
              data-testid="tg-tv-demo-alert"
            >
              Demo: {demoNextLabel ?? 'Alert'}
            </button>
          )}
          <button
            type="button"
            className={soundOn ? 'tg-tv-control tg-tv-sound-on' : 'tg-tv-control'}
            aria-pressed={soundOn}
            onClick={toggleSound}
            data-testid="tg-tv-sound-toggle"
            title={soundOn ? 'Broadcast alerts enabled on all TV notifications' : 'Enable loud broadcast sound on TV notifications'}
          >
            <SoundIcon muted={!soundOn} size={15} />
            <span>{soundOn ? 'Sound on' : 'Muted'}</span>
          </button>
          {soundOn && (
            <button
              type="button"
              className={turduckenMode ? 'tg-tv-control tg-tv-turducken-on' : 'tg-tv-control'}
              aria-pressed={turduckenMode}
              onClick={toggleTurducken}
              data-testid="tg-tv-turducken-toggle"
              title="Add a turkey gobble and 'Boom! Turducken!' callout to TV alerts"
            >
              <span>{turduckenMode ? 'Turducken: ON' : 'Turducken'}</span>
            </button>
          )}
          <button type="button" className="tg-tv-exit" onClick={onExit}>Exit full screen</button>
        </div>
      </header>

      <div className="tg-tv-body">
        <section className="tg-tv-game" aria-label="Game">
          {game && (
            <TvGame
              game={game}
              phase={phaseOf.get(game.id) ?? 'open'}
              result={results[game.id] ?? null}
              names={names}
              playAlert={playAlerts[game.id] ?? null}
              flashes={categoryFlashes[game.id] ?? {}}
            />
          )}
        </section>
        <aside className="tg-tv-standings" aria-labelledby="tg-tv-standings-title">
          <div className="tg-standings-head">
            <h2 id="tg-tv-standings-title">Overall standings</h2>
            {standings?.status === 'live' && (
              <span className="tg-live-badge" role="img" aria-label="Live">
                <span className="tg-live-pill-dot" aria-hidden="true" />
                Live
              </span>
            )}
          </div>
          {champions.length > 0 && (
            <ChampionBanner
              title={champions.length > 1 ? 'Co-champions' : 'Thanksgiving Champion'}
              names={champions.join(' & ')}
            />
          )}
          {standings && standings.status !== 'pre' ? (
            <table className="tg-tv-table" data-testid="tg-tv-standings">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Player</th>
                  {finalStandings ? (
                    <th scope="col" className="tg-num">Pts</th>
                  ) : (
                    <>
                      <th scope="col" className="tg-num" aria-sort={sortBy === 'live' ? 'descending' : 'none'}>
                        <button
                          type="button"
                          className={sortBy === 'live' ? 'tg-col-sort tg-live-points tg-col-active' : 'tg-col-sort tg-live-points'}
                          aria-pressed={sortBy === 'live'}
                          onClick={() => setSortBy('live')}
                        >
                          Live{sortBy === 'live' ? ' ↓' : ''}
                        </button>
                      </th>
                      <th scope="col" className="tg-num" aria-sort={sortBy === 'banked' ? 'descending' : 'none'}>
                        <button
                          type="button"
                          className={sortBy === 'banked' ? 'tg-col-sort tg-board-locked tg-col-active' : 'tg-col-sort tg-board-locked'}
                          aria-pressed={sortBy === 'banked'}
                          onClick={() => setSortBy('banked')}
                        >
                          <CheckIcon size={12} /> Banked{sortBy === 'banked' ? ' ↓' : ''}
                        </button>
                      </th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {rankStandings(standings.rows.filter((r) => names.has(r.playerId)), locked, finalStandings, sortBy).map((r) => {
                  const movedUp = rankUpSet.has(r.playerId);
                  const rowCls = [r.rank === 1 ? 'tg-tv-leader' : '', movedUp ? 'tg-tv-rank-up' : ''].filter(Boolean).join(' ') || undefined;
                  return (
                    <tr key={r.playerId} className={rowCls}>
                      <td className="tg-rank"><RankMedal rank={r.rank} size={36} /></td>
                      <td>
                        {names.get(r.playerId)}
                        {movedUp && <span className="tg-tv-up-arrow" aria-label="Moved up"> ▲</span>}
                      </td>
                      {finalStandings ? (
                        <td className="tg-num">{r.live}</td>
                      ) : (
                        <>
                          <td className={sortBy === 'live' ? 'tg-num tg-live-points tg-col-active' : 'tg-num tg-live-points tg-col-secondary'}>
                            {r.live}
                          </td>
                          <td className={sortBy === 'banked' ? 'tg-num tg-board-locked tg-col-active' : 'tg-num tg-board-locked tg-col-secondary'}>
                            {r.locked}
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
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

function TvGame({
  game,
  phase,
  result,
  names,
  playAlert,
  flashes,
}: {
  game: Game;
  phase: GamePhase;
  result: GameResult | null;
  names: Map<string, string>;
  playAlert: GameAlert | null;
  flashes: Partial<Record<CategoryKey, 'final' | 'live'>>;
}) {
  const scored = phase !== 'open' && !!result && result.score.status !== 'pre';
  const { line, projection } = game;
  const gameWinners = (result?.score.winners ?? []).map((id) => names.get(id)).filter((n): n is string => Boolean(n));
  return (
    <>
      <div className="tg-tv-scoreboard-head">
        <h2 className="tg-tv-matchup" data-testid="tg-tv-matchup">
          <span className="tg-matchup-team"><TeamLogo team={game.away} size={56} /> {game.away.shortName}</span>
          {scored ? (
            <span className="tg-matchup-score">{result!.stats.away} <span className="tg-score-dash">–</span> {result!.stats.home}</span>
          ) : (
            <span className="tg-matchup-at">@</span>
          )}
          <span className="tg-matchup-team">{game.home.shortName} <TeamLogo team={game.home} size={56} /></span>
        </h2>
        <p className="tg-tv-sub">
          {scored ? (
            <span className={phase === 'live' ? 'tg-clock tg-clock-live' : 'tg-clock'}>
              {phase === 'live' && <span className="tg-live-pill-dot" aria-hidden="true" />}
              {gameClock(result!.stats)}
            </span>
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
      </div>

      {playAlert && <TvPlayStrip alert={playAlert} game={game} names={names} />}

      {gameWinners.length > 0 && (
        <ChampionBanner
          title={gameWinners.length > 1 ? 'Game winners' : 'Game winner'}
          names={gameWinners.join(' & ')}
        />
      )}

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
              const flash = flashes[c.key];
              const rowClass = flash ? `tg-tv-row-flash-${flash}` : undefined;
              return (
                <tr key={c.key} className={rowClass} data-testid={`tg-tv-cat-${c.key}`}>
                  <th scope="row">{c.label}</th>
                  <td className="tg-num">{worthBadge(c.worth)}</td>
                  <td><TeamText text={c.answer} teams={[game.away, game.home]} /></td>
                  <td className={final ? undefined : 'tg-projected'}>{right.length ? right.join(', ') : '—'}</td>
                  <td className={final ? 'tg-tv-final' : 'tg-tv-live'}>
                    <span className="tg-tv-status">
                      {final ? <><CheckIcon size={13} /> Final</> : <><LiveCircleIcon size={13} /> Live</>}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
