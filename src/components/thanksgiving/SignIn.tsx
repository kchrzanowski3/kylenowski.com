import { useState } from 'react';
import { join, login, switchPlayer, type Clients } from '../../lib/thanksgiving/client';
import { isValidPin, nameProblem } from '../../lib/thanksgiving/players';
import type { Player } from '../../lib/thanksgiving/view';
import { KeyIcon } from './icons';

interface Props {
  clients: Clients;
  players: Player[];
  joinOpen: boolean;
  /** Signed in as a player that has since been removed. */
  signedInElsewhere: boolean;
  /** Called after one-tap sign-in on a PIN-less player chip so the app can show a quick undo toast. */
  onQuickSignIn?: (player: Player) => void;
}

export function SignIn({ clients, players, joinOpen, signedInElsewhere, onQuickSignIn }: Props) {
  const [mode, setMode] = useState<'pick' | 'join'>(players.length === 0 && joinOpen ? 'join' : 'pick');
  const [chosen, setChosen] = useState<Player | null>(null);
  const [pin, setPin] = useState('');
  const [name, setName] = useState('');
  const [newPin, setNewPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      if (signedInElsewhere) await switchPlayer(clients.auth);
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function choose(p: Player) {
    setError(null);
    setPin('');
    if (p.hasPin) setChosen(p);
    else {
      void run(async () => {
        await login(clients.auth, p.id, '');
        onQuickSignIn?.(p);
      });
    }
  }

  function submitPin(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!chosen) return;
    if (!isValidPin(pin)) return setError('A PIN is 4 digits.');
    void run(() => login(clients.auth, chosen.id, pin));
  }

  function submitJoin(e: { preventDefault(): void }) {
    e.preventDefault();
    const problem = nameProblem(name);
    if (problem) return setError(problem);
    if (newPin && !isValidPin(newPin)) return setError('A PIN is 4 digits (or leave it empty).');
    void run(() => join(clients.auth, name, newPin));
  }

  return (
    <section className="tg-card tg-signin" aria-labelledby="tg-signin-title">
      <h2 id="tg-signin-title">{mode === 'join' ? 'Join the game' : 'Who are you?'}</h2>

      {mode === 'pick' && !chosen && (
        <>
          {players.length > 0 ? (
            <ul className="tg-names">
              {players.map((p) => (
                <li key={p.id}>
                  <button type="button" className="tg-chip" disabled={busy} onClick={() => choose(p)}>
                    <span>{p.name}</span>
                    {p.hasPin && <KeyIcon className="tg-pin-icon" size={13} label="has a PIN" />}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Nobody has joined yet.</p>
          )}
          {joinOpen ? (
            <p>
              New here?{' '}
              <button type="button" className="tg-link" onClick={() => { setMode('join'); setError(null); }}>
                Join with your name
              </button>
            </p>
          ) : (
            <p className="muted">Joining is closed: every game has kicked off.</p>
          )}
        </>
      )}

      {mode === 'pick' && chosen && (
        <form onSubmit={submitPin} className="tg-form">
          <label htmlFor="tg-pin">PIN for {chosen.name}</label>
          <input
            id="tg-pin"
            className="tg-pin-input"
            inputMode="numeric"
            autoComplete="off"
            pattern="[0-9]{4}"
            maxLength={4}
            value={pin}
            autoFocus
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          />
          <div className="tg-actions">
            <button type="submit" className="tg-primary" disabled={busy}>Sign in</button>
            <button type="button" className="tg-link" onClick={() => { setChosen(null); setError(null); }}>
              Not {chosen.name}?
            </button>
          </div>
          <p className="muted tg-small">Forgot it? Ask Kyle to reset it.</p>
        </form>
      )}

      {mode === 'join' && (
        <form onSubmit={submitJoin} className="tg-form">
          <label htmlFor="tg-name">Your name</label>
          <input id="tg-name" value={name} maxLength={20} autoComplete="given-name" onChange={(e) => setName(e.target.value)} autoFocus />
          <label htmlFor="tg-newpin">
            4-digit PIN <span className="muted">(optional)</span>
          </label>
          <input
            id="tg-newpin"
            className="tg-pin-input"
            inputMode="numeric"
            autoComplete="off"
            pattern="[0-9]{4}"
            maxLength={4}
            value={newPin}
            onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
          />
          <p className="muted tg-small">
            Without a PIN, anyone can pick your name. With one, you'll need it to sign in on another phone.
          </p>
          <div className="tg-actions">
            <button type="submit" className="tg-primary" disabled={busy}>Join</button>
            {players.length > 0 && (
              <button type="button" className="tg-link" onClick={() => { setMode('pick'); setError(null); }}>
                I've already joined
              </button>
            )}
          </div>
        </form>
      )}

      {error && <p className="tg-error" role="alert">{error}</p>}
    </section>
  );
}
