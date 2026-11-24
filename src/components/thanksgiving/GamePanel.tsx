import { collection, doc, onSnapshot } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { getRevealDb, type Clients } from '../../lib/thanksgiving/client';
import { etDateTime } from '../../lib/thanksgiving/config';
import { isLocked } from '../../lib/thanksgiving/kickoff';
import type { Answers } from '../../lib/thanksgiving/questions';
import { countdown, type Game, type GamePhase, type Pick, type Player } from '../../lib/thanksgiving/view';
import { PhaseBadge, TeamLogo } from './icons';
import { PickForm } from './PickForm';
import { Scoreboard, gameClock, type GameResult } from './Scoreboard';

interface Props {
  clients: Clients;
  game: Game;
  me: Player | null;
  players: Player[];
  now: number;
  result: GameResult | null;
  phase: GamePhase;
  nextGame?: Game | null;
  nextAnswered?: number;
  onSelectGame?: (id: string) => void;
}

export function GamePanel({ clients, game, me, players, now, result, phase, nextGame = null, nextAnswered = 0, onSelectGame }: Props) {
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

  const scored = locked && !!result && result.score.status !== 'pre';

  return (
    <section className="tg-game" aria-labelledby={`tg-game-${game.id}`}>
      <header className={scored ? 'tg-game-head tg-game-head-scored' : 'tg-game-head'}>
        {/* Once the game is under way the team names carry the score, with the clock below. */}
        <h2 id={`tg-game-${game.id}`} className="tg-matchup" data-testid={scored ? 'tg-livescore' : undefined}>
          <span className="tg-matchup-team"><TeamLogo team={game.away} size={42} /> {game.away.shortName}</span>
          {scored ? (
            <span className="tg-matchup-score">
              {result!.stats.away} <span className="tg-score-dash">–</span> {result!.stats.home}
            </span>
          ) : (
            <span className="tg-matchup-at">@</span>
          )}
          <span className="tg-matchup-team">{game.home.shortName} <TeamLogo team={game.home} size={42} /></span>
        </h2>
        <div className="tg-game-meta">
          {scored && (
            <span className={phase === 'live' ? 'tg-clock tg-clock-live' : 'tg-clock'} data-testid="tg-clock">
              {phase === 'live' && <span className="tg-live-pill-dot" aria-hidden="true" />}
              {gameClock(result!.stats)}
            </span>
          )}
          <PhaseBadge
            phase={phase}
            text={phase === 'open' ? countdown(game.kickoff - now) : phase === 'live' ? 'Live' : 'Final'}
            testId="tg-lock-status"
          />
          <span className="tg-game-broadcast">
            {etDateTime(game.kickoff)}
            {game.tv ? ` · ${game.tv}` : ''}
          </span>
        </div>
      </header>

      {!locked && me && mine?.playerId !== me.id && <p className="muted">Loading your picks…</p>}
      {!locked && me && mine?.playerId === me.id && (
        <PickForm
          key={me.id}
          clients={clients}
          game={game}
          me={me}
          saved={mine.answers}
          now={now}
          nextGame={nextGame}
          nextAnswered={nextAnswered}
          onSelectGame={onSelectGame}
        />
      )}
      {!locked && !me && <p className="muted tg-signin-nudge">Sign in above to make your picks.</p>}
      {locked && <Scoreboard game={game} result={result} picks={everyone} players={players} me={me} />}
    </section>
  );
}
