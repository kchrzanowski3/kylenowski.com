// The signed-in player's menu, top right of the page (docs/thanksgiving-spec.md, "Page layout"):
// who you're playing as, add or change your PIN, switch player.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { changePin, switchPlayer, type Clients } from '../../lib/thanksgiving/client';
import { isValidPin } from '../../lib/thanksgiving/players';
import type { Player } from '../../lib/thanksgiving/view';

/** The page puts an empty slot next to its heading (thanksgiving.astro); without one, render in place. */
function Slot({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById('tg-account-slot')), []);
  return slot ? createPortal(children, slot) : <div className="tg-account-inline">{children}</div>;
}

export function AccountMenu({ clients, me }: { clients: Clients; me: Player }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const root = useRef<HTMLDivElement>(null);

  // Close on a tap outside the menu, or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function submit(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!isValidPin(pin)) return setMessage({ ok: false, text: 'A PIN is 4 digits.' });
    setBusy(true);
    try {
      await changePin(clients.auth, pin);
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
    <Slot>
      <div className="tg-menu" ref={root}>
        <button
          type="button"
          className="tg-avatar"
          aria-haspopup="true"
          aria-expanded={open}
          aria-label={`Account: ${me.name}`}
          onClick={() => { setOpen(!open); setMessage(null); setEditing(false); }}
        >
          <span aria-hidden="true">{me.name.trim().charAt(0).toUpperCase()}</span>
          <span className="tg-sr-only" data-testid="tg-me">{me.name}</span>
        </button>
        {open && (
          <div className="tg-menu-panel" role="menu" aria-label="Account">
            <p className="tg-menu-name">{me.name}</p>
            {editing ? (
              <form onSubmit={submit} className="tg-form tg-menu-form">
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
            ) : (
              <button type="button" role="menuitem" className="tg-menu-item" onClick={() => { setEditing(true); setMessage(null); }}>
                {me.hasPin ? 'Change PIN' : 'Add a PIN'}
              </button>
            )}
            <button type="button" role="menuitem" className="tg-menu-item" onClick={() => { setOpen(false); void switchPlayer(clients.auth); }}>
              Switch player
            </button>
            {message && <p className={message.ok ? 'tg-ok tg-small' : 'tg-error tg-small'} role="status">{message.text}</p>}
          </div>
        )}
      </div>
    </Slot>
  );
}
