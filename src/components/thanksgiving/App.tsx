import type { User } from 'firebase/auth';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { getClients, watchUser, type Clients } from '../../lib/thanksgiving/client';
import { isLocked } from '../../lib/thanksgiving/kickoff';
import { toGame, type Game, type Player } from '../../lib/thanksgiving/view';
import { Account } from './Account';
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
    return () => {
      offUser();
      offGames();
      offPlayers();
    };
  }, [clients]);

  const me = useMemo(() => (user && players ? players.find((p) => p.id === user.uid) ?? null : null), [user, players]);

  // Start on the next game to lock (or the last game once they've all started), then stay on it:
  // when a game kicks off, its picks are revealed right where you're looking.
  useEffect(() => {
    if (tab || !games || games.length === 0) return;
    const t = Date.now();
    setTab((games.find((g) => !isLocked(g.kickoff, t)) ?? games[games.length - 1]).id);
  }, [games, tab]);
  const activeId = tab && games?.some((g) => g.id === tab) ? tab : (games?.[0]?.id ?? null);

  if (loadError) return <p className="tg-error" role="alert">{loadError}</p>;
  if (!clients || games === null || players === null || user === undefined) return <p className="muted">Loading…</p>;

  const lastKickoff = games.reduce((m, g) => Math.max(m, g.kickoff), 0);
  const joinOpen = games.length === 0 || now < lastKickoff;
  const active = games.find((g) => g.id === activeId) ?? null;

  return (
    <div className="tg">
      {me ? (
        <Account clients={clients} me={me} />
      ) : (
        <SignIn clients={clients} players={players} joinOpen={joinOpen} signedInElsewhere={!!user && !me} />
      )}

      {games.length === 0 ? (
        <p className="muted">The games will show up here shortly.</p>
      ) : (
        <>
          <nav className="tg-tabs" aria-label="Games">
            {games.map((g) => (
              <button
                key={g.id}
                type="button"
                className="tg-tab"
                aria-current={g.id === activeId ? 'page' : undefined}
                onClick={() => setTab(g.id)}
              >
                <span className="tg-tab-teams">
                  {g.away.abbr} @ {g.home.abbr}
                </span>
                <span className="tg-tab-status">{isLocked(g.kickoff, now) ? 'Locked' : 'Open'}</span>
              </button>
            ))}
          </nav>
          {active && <GamePanel key={active.id} clients={clients} game={active} me={me} players={players} now={now} />}
        </>
      )}
    </div>
  );
}
