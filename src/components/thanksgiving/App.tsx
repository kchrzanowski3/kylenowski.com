import type { User } from 'firebase/auth';
import { collection, doc, onSnapshot, orderBy, query } from 'firebase/firestore';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getClients, watchUser, type Clients } from '../../lib/thanksgiving/client';
import { QUESTION_COUNT, answeredCount, type Answers } from '../../lib/thanksgiving/questions';
import type { Standings as StandingsData } from '../../lib/thanksgiving/scoring';
import { autoGameId, gamePhase, lockedPoints, toGame, type Game, type Player } from '../../lib/thanksgiving/view';
import { TvView } from './TvView';
import { AccountMenu } from './AccountMenu';
import { LockIcon, TeamLogo } from './icons';
import type { GameResult } from './Scoreboard';
import { Standings } from './Standings';
import { GamePanel } from './GamePanel';
import { SignIn } from './SignIn';

/** Ticks once a second, so locks and countdowns update on their own. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export default function App() {
  const [clients, setClients] = useState<Clients | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [games, setGames] = useState<Game[] | null>(null);
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [tab, setTab] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, GameResult>>({});
  const [standings, setStandings] = useState<StandingsData | null>(null);
  const now = useNow();

  useEffect(() => {
    getClients().then(setClients, (e: unknown) => setLoadError(String(e)));
  }, []);

  useEffect(() => {
    if (!clients) return;
    const offUser = watchUser(clients.auth, setUser);
    const offGames = onSnapshot(
      query(collection(clients.db, 'tgGames'), orderBy('order')),
      (snap) => setGames(snap.docs.map((d) => toGame(d.id, d.data())).filter((g): g is Game => g !== null)),
      (e) => setLoadError(`Couldn't load the games: ${e.message}`),
    );
    const offPlayers = onSnapshot(
      query(collection(clients.db, 'tgPlayers'), orderBy('name')),
      (snap) => setPlayers(snap.docs.map((d) => ({ id: d.id, name: d.get('name'), hasPin: !!d.get('hasPin') }))),
      (e) => setLoadError(`Couldn't load the players: ${e.message}`),
    );
    // Published scores (after the spoiler delay); public, so no sign-in needed.
    const offResults = onSnapshot(collection(clients.db, 'tgResults'), (snap) =>
      setResults(Object.fromEntries(snap.docs.map((d) => [d.id, { stats: d.get('stats'), score: d.get('score') } as GameResult]))),
    );
    const offStandings = onSnapshot(doc(clients.db, 'tgStandings/overall'), (snap) =>
      setStandings(snap.exists() ? (snap.data() as StandingsData) : null),
    );
    return () => {
      offUser();
      offGames();
      offPlayers();
      offResults();
      offStandings();
    };
  }, [clients]);

  const me = useMemo(() => (user && players ? players.find((p) => p.id === user.uid) ?? null : null), [user, players]);

  // Right after joining, Auth knows the new player a moment before the player list does. Give it a
  // few seconds before treating the sign-in as one whose player no longer exists.
  const [userSeenAt, setUserSeenAt] = useState(0);
  useEffect(() => setUserSeenAt(Date.now()), [user]);
  const waitingForPlayer = !!user && !me && now - userSeenAt < 5000;

  // How many of the questions you've answered in each game, for the progress bar on its tab.
  const meId = me?.id ?? null;
  const gameIds = (games ?? []).map((g) => g.id).join(',');
  const [answered, setAnswered] = useState<Record<string, number>>({});
  useEffect(() => {
    setAnswered({});
    if (!clients || !meId || !gameIds) return;
    const offs = gameIds.split(',').map((id) =>
      onSnapshot(
        doc(clients.db, `tgGames/${id}/picks/${meId}`),
        (snap) => setAnswered((a) => ({ ...a, [id]: snap.exists() ? answeredCount((snap.get('answers') as Answers) ?? {}) : 0 })),
        () => {}, // right after signing in this can be refused for a moment; the bar just stays empty
      ),
    );
    return () => offs.forEach((off) => off());
  }, [clients, meId, gameIds]);

  // Open on the game being played, else the next to kick off, else the last; follow it as games
  // kick off, until you pick a tab yourself.
  const phases = (games ?? []).map((g) => ({ id: g.id, phase: gamePhase(g.kickoff, results[g.id]?.stats?.state, now) }));
  const phaseOf = new Map(phases.map((p) => [p.id, p.phase]));
  const activeId = tab && games?.some((g) => g.id === tab) ? tab : autoGameId(phases);

  // Locked points (final categories, finished games) for the standings and the full-screen view.
  const locked = useMemo(() => lockedPoints(results), [results]);
  const [tv, setTv] = useState(false);
  const exitTv = useCallback(() => setTv(false), []);
  const enterTv = useCallback(() => setTv(true), []);

  if (loadError) return <p className="tg-error" role="alert">{loadError}</p>;
  if (!clients || games === null || players === null || user === undefined) return <p className="muted">Loading…</p>;

  const lastKickoff = games.reduce((m, g) => Math.max(m, g.kickoff), 0);
  const joinOpen = games.length === 0 || now < lastKickoff;
  const active = games.find((g) => g.id === activeId) ?? null;
  const showStandings = !!standings && standings.status !== 'pre';

  // Next open game that still needs picks, for the celebratory 15/15 handoff button.
  const nextOpenGame =
    games.find((g) => g.id !== activeId && phaseOf.get(g.id) === 'open' && (answered[g.id] ?? 0) < QUESTION_COUNT) ??
    null;

  const selectGame = (id: string) => {
    setTab(id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className={showStandings ? 'tg tg-arena tg-arena-split' : 'tg tg-arena'}>
      <AccountMenu clients={clients} me={me} onFullScreen={enterTv} />
      {tv && (
        <TvView games={games} phases={phases} results={results} standings={standings} locked={locked} players={players} onExit={exitTv} />
      )}

      {showStandings && (
        <aside className="tg-rail" aria-label="Standings">
          <Standings standings={standings} games={games} players={players} me={me} locked={locked} />
        </aside>
      )}

      <div className="tg-main">
        {me ? null : waitingForPlayer ? (
          <p className="muted">Signing you in…</p>
        ) : (
          <SignIn clients={clients} players={players} joinOpen={joinOpen} signedInElsewhere={!!user && !me} />
        )}

        {games.length === 0 ? (
          <p className="muted">The games will show up here shortly.</p>
        ) : (
          <>
            <nav className="tg-tabs" aria-label="Games">
              {games.map((g) => {
                const phase = phaseOf.get(g.id)!;
                const n = answered[g.id] ?? 0;
                const tabScore = phase !== 'open' && results[g.id]?.stats && results[g.id].stats.state !== 'pre' ? results[g.id].stats : null;
                return (
                  <button
                    key={g.id}
                    type="button"
                    className={`tg-tab tg-tab-${phase}`}
                    aria-current={g.id === activeId ? 'page' : undefined}
                    onClick={() => setTab(g.id)}
                  >
                    <span className="tg-tab-logos" aria-hidden="true">
                      <TeamLogo team={g.away} size={28} />
                      <TeamLogo team={g.home} size={28} />
                    </span>
                    <span className="tg-tab-teams">
                      {g.away.abbr} @ {g.home.abbr}
                    </span>
                    <span className="tg-tab-meta">
                      <LockIcon phase={phase} size={13} />
                      {phase === 'live' ? (
                        <span className="tg-tab-live-tag">
                          {tabScore ? `${tabScore.away}–${tabScore.home}` : 'LIVE'}
                        </span>
                      ) : phase === 'final' && tabScore ? (
                        <span className="tg-tab-final-tag">{tabScore.away}–{tabScore.home}</span>
                      ) : me ? (
                        <span className="tg-tab-count">{n}/{QUESTION_COUNT}</span>
                      ) : null}
                    </span>
                    {me && (
                      <span
                        className="tg-progress"
                        role="progressbar"
                        aria-label="Your picks"
                        aria-valuemin={0}
                        aria-valuemax={QUESTION_COUNT}
                        aria-valuenow={n}
                        data-testid={`tg-progress-${g.id}`}
                      >
                        <span className={n >= QUESTION_COUNT ? 'tg-progress-fill tg-progress-full' : 'tg-progress-fill'} style={{ width: `${(100 * n) / QUESTION_COUNT}%` }} />
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
            {active && (
              <GamePanel
                key={active.id}
                clients={clients}
                game={active}
                me={me}
                players={players}
                now={now}
                result={results[active.id] ?? null}
                phase={phaseOf.get(active.id)!}
                nextGame={nextOpenGame}
                nextAnswered={nextOpenGame ? (answered[nextOpenGame.id] ?? 0) : 0}
                onSelectGame={selectGame}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
