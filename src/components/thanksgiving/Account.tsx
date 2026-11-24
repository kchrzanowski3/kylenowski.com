import { useState } from 'react';
import { changePin, switchPlayer, type Clients } from '../../lib/thanksgiving/client';
import { isValidPin } from '../../lib/thanksgiving/players';
import type { Player } from '../../lib/thanksgiving/view';

export function Account({ clients, me }: { clients: Clients; me: Player }) {
  const [editing, setEditing] = useState(false);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!isValidPin(pin)) return setMessage({ ok: false, text: 'A PIN is 4 digits.' });
    setBusy(true);
    try {
      await changePin(clients, pin);
      setMessage({ ok: true, text: 'PIN saved.' });
      setEditing(false);
      setPin('');
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="tg-account" aria-label="Your account">
      <p>
        Playing as <strong data-testid="tg-me">{me.name}</strong>
        <span className="tg-account-actions">
          <button type="button" className="tg-link" onClick={() => { setEditing(!editing); setMessage(null); }}>
            {me.hasPin ? 'Change PIN' : 'Add a PIN'}
          </button>
          <button type="button" className="tg-link" onClick={() => void switchPlayer(clients.auth)}>
            Switch player
          </button>
        </span>
      </p>
      {editing && (
        <form onSubmit={submit} className="tg-form tg-inline">
          <label htmlFor="tg-setpin">New 4-digit PIN</label>
          <input
            id="tg-setpin"
            className="tg-pin-input"
            inputMode="numeric"
            autoComplete="off"
            pattern="[0-9]{4}"
            maxLength={4}
            value={pin}
            autoFocus
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          />
          <button type="submit" className="tg-primary" disabled={busy}>Save PIN</button>
        </form>
      )}
      {message && <p className={message.ok ? 'tg-ok' : 'tg-error'} role="status">{message.text}</p>}
    </section>
  );
}
