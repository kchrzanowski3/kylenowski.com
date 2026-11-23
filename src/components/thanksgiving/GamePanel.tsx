import { collection, doc, onSnapshot } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { getRevealDb, type Clients } from '../../lib/thanksgiving/client';
import { etDateTime } from '../../lib/thanksgiving/config';
import { isLocked } from '../../lib/thanksgiving/kickoff';
import { formatPoints } from '../../lib/thanksgiving/projection';
import type { Answers } from '../../lib/thanksgiving/questions';
import { countdown, type Game, type Pick, type Player } from '../../lib/thanksgiving/view';
import { PickForm } from './PickForm';
import { RevealTable } from './RevealTable';

interface Props {
  clients: Clients;
  game: Game;
  me: Player | null;
  players: Player[];
  now: number;
}

export function GamePanel({ clients, game, me, players, now }: Props) {
  const locked = isLocked(game.kickoff, now);
  // Your saved picks, tagged with whose they are, so the form never starts from another sign-in's
  // (or a not-yet-loaded) state.
  const [mine, setMine] = useState<{ playerId: string; answers: Answers | null } | null>(null);
  const [everyone, setEveryone] = useState<Pick[] | null>(null);
  const [revealRetry, setRevealRetry] = useState(0);
  const [mineRetry, setMineRetry] = useState(0);
  const meId = me?.id ?? null;
  useEffect(() => setMineRetry(0), [meId]); // each sign-in gets its own retries

  // Your own saved picks (readable any time). Right after signing in, Firestore can still be using
  // the previous sign-in for a moment and refuse the read; try again shortly rather than showing an
  // empty form over saved picks.
  useEffect(() => {
    if (!meId) return;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const off = onSnapshot(
      doc(clients.db, `tgGames/${game.id}/picks/${meId}`),
      (snap) => setMine({ playerId: meId, answers: snap.exists() ? ((snap.get('answers') as Answers) ?? {}) : null }),
      (e) => {
        console.warn(`Couldn't load your picks yet (${e.code}); retrying.`);
        if (mineRetry < 5) retry = setTimeout(() => setMineRetry((n) => n + 1), 1000);
        else setMine({ playerId: meId, answers: null });
      },
    );
    return () => {
      off();
      if (retry) clearTimeout(retry);
    };
  }, [clients, game.id, meId, mineRetry]);

  // Everyone's picks, once the game has kicked off, on a connection opened after kickoff (see
  // getRevealDb). If this phone's clock runs a little ahead of the server's, the first try is
  // refused; try again shortly.
  useEffect(() => {
    if (!locked) return;
    let cancelled = false;
    let off: (() => void) | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    void getRevealDb(game.id).then((db) => {
      if (cancelled) return;
      off = onSnapshot(
        collection(db, `tgGames/${game.id}/picks`),
        (snap) => setEveryone(snap.docs.map((d) => ({ playerId: d.id, answers: (d.get('answers') as Answers) ?? {} }))),
        (e) => {
          console.warn(`Couldn't load everyone's picks yet (${e.code}); retrying.`);
          retry = setTimeout(() => setRevealRetry((n) => n + 1), 3000);
        },
      );
    });
    return () => {
      cancelled = true;
      off?.();
      if (retry) clearTimeout(retry);
    };
  }, [game.id, locked, revealRetry]);

  const { line, projection } = game;

  return (
    <section className="tg-game" aria-labelledby={`tg-game-${game.id}`}>
      <header className="tg-game-head">
        <h2 id={`tg-game-${game.id}`}>
          {game.away.shortName} <span className="muted">@</span> {game.home.shortName}
        </h2>
        <p className="muted">
          Game {game.order} · {etDateTime(game.kickoff)}
          {game.tv ? ` · ${game.tv}` : ''}
        </p>
        <p className={locked ? 'tg-status tg-status-locked' : 'tg-status'} data-testid="tg-lock-status">
          {locked ? 'Picks are locked and revealed.' : `Picks lock at kickoff, in ${countdown(game.kickoff - now)}.`}
        </p>
        {line && projection && (
          <p className="tg-vegas">
            <strong>Vegas:</strong> {line.details || 'Pick’em'}, O/U {formatPoints(line.overUnder)} → projects{' '}
            {game.away.abbr} {formatPoints(projection.away)} – {game.home.abbr} {formatPoints(projection.home)}
          </p>
        )}
      </header>

      {!locked && me && mine?.playerId !== me.id && <p className="muted">Loading your picks…</p>}
      {!locked && me && mine?.playerId === me.id && (
        <PickForm key={me.id} clients={clients} game={game} me={me} saved={mine.answers} now={now} />
      )}
      {!locked && !me && <p className="muted">Sign in above to make your picks. Everyone's picks are shown here at kickoff.</p>}
      {locked && <RevealTable game={game} picks={everyone} players={players} me={me} />}
    </section>
  );
}
