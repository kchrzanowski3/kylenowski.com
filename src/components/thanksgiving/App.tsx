import type { User } from 'firebase/auth';
import { collection, doc, onSnapshot, orderBy, query } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { getClients, watchUser, type Clients } from '../../lib/thanksgiving/client';
import { QUESTION_COUNT, answeredCount, type Answers } from '../../lib/thanksgiving/questions';
import type { Standings as StandingsData } from '../../lib/thanksgiving/scoring';
import { autoGameId, gamePhase, toGame, type Game, type Player } from '../../lib/thanksgiving/view';
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

  if (loadError) return <p className="tg-error" role="alert">{loadError}</p>;
  if (!clients || games === null || players === null || user === undefined) return <p className="muted">Loading…</p>;

  const lastKickoff = games.reduce((m, g) => Math.max(m, g.kickoff), 0);
  const joinOpen = games.length === 0 || now < lastKickoff;
  const active = games.find((g) => g.id === activeId) ?? null;

  return (
    <div className="tg">
      {me ? (
        <AccountMenu clients={clients} me={me} />
      ) : waitingForPlayer ? (
        <p className="muted">Signing you in…</p>
      ) : (
        <SignIn clients={clients} players={players} joinOpen={joinOpen} signedInElsewhere={!!user && !me} />
      )}

      {standings && standings.status !== 'pre' && <Standings standings={standings} games={games} players={players} me={me} />}

      {games.length === 0 ? (
        <p className="muted">The games will show up here shortly.</p>
      ) : (
        <>
          <nav className="tg-tabs" aria-label="Games">
            {games.map((g) => {
              const phase = phaseOf.get(g.id)!;
              const n = answered[g.id] ?? 0;
              return (
                <button
                  key={g.id}
                  type="button"
                  className={`tg-tab tg-tab-${phase}`}
                  aria-current={g.id === activeId ? 'page' : undefined}
                  onClick={() => setTab(g.id)}
                >
                  <span className="tg-tab-logos" aria-hidden="true">
                    <TeamLogo team={g.away} size={26} />
                    <TeamLogo team={g.home} size={26} />
                  </span>
                  <span className="tg-tab-teams">
                    {g.away.abbr} @ {g.home.abbr}
                  </span>
                  <LockIcon phase={phase} size={14} />
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
            <GamePanel key={active.id} clients={clients} game={active} me={me} players={players} now={now} result={results[active.id] ?? null} phase={phaseOf.get(active.id)!} />
          )}
        </>
      )}
    </div>
  );
}
