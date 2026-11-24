// The controls at the top right of the stadium masthead (docs/thanksgiving-spec.md, "Page layout"):
// quick-access Rules ("How it works") and TV ("Full screen scoreboard") buttons plus the account
// menu (player identity, PIN management with explicit Cancel, switch player, and full-screen/rules).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { changePin, switchPlayer, type Clients } from '../../lib/thanksgiving/client';
import { isValidPin } from '../../lib/thanksgiving/players';
import type { Player } from '../../lib/thanksgiving/view';
import { HelpIcon, TvIcon } from './icons';

/** The page puts an empty slot next to its heading (thanksgiving.astro); without one, render in place. */
function Slot({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById('tg-account-slot')), []);
  return slot ? createPortal(children, slot) : <div className="tg-account-inline">{children}</div>;
}

export function AccountMenu({
  clients,
  me,
  onFullScreen,
  onOpenRules,
}: {
  clients: Clients;
  me: Player | null;
  onFullScreen: () => void;
  onOpenRules: () => void;
}) {
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
      if (!me) return;
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
      <div className="tg-masthead-actions">
        <button
          type="button"
          className="tg-header-btn"
          aria-label="How it works"
          title="How it works"
          data-testid="tg-rules-btn"
          onClick={onOpenRules}
        >
          <HelpIcon size={17} />
          <span className="tg-header-btn-label">Rules</span>
        </button>
        <button
          type="button"
          className="tg-header-btn"
          aria-label="Full screen scoreboard"
          title="Full screen scoreboard (TV view)"
          data-testid="tg-tv-btn"
          onClick={onFullScreen}
        >
          <TvIcon size={17} />
          <span className="tg-header-btn-label">TV</span>
        </button>
        <div className="tg-menu" ref={root}>
          <button
            type="button"
            className={me ? 'tg-avatar tg-avatar-signed' : 'tg-avatar'}
            aria-haspopup="true"
            aria-expanded={open}
            aria-label={me ? `Account: ${me.name}` : 'Menu'}
            onClick={() => {
              setOpen(!open);
              setMessage(null);
              setEditing(false);
              setPin('');
            }}
          >
            {me ? (
              <>
                <span className="tg-avatar-initial" aria-hidden="true">
                  {me.name.trim().charAt(0).toUpperCase()}
                </span>
                <span className="tg-avatar-name" data-testid="tg-me">
                  {me.name}
                </span>
              </>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="8.5" r="4" fill="currentColor" />
                <path d="M4 20.5c1.2-4.2 4.4-6.2 8-6.2s6.8 2 8 6.2" fill="currentColor" />
              </svg>
            )}
          </button>
          {open && (
            <div className="tg-menu-panel" role="menu" aria-label="Account">
              {me && (
                <>
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
                      <div className="tg-menu-form-actions">
                        <button type="submit" className="tg-primary" disabled={busy}>
                          Save PIN
                        </button>
                        <button
                          type="button"
                          className="tg-secondary"
                          disabled={busy}
                          onClick={() => {
                            setEditing(false);
                            setPin('');
                            setMessage(null);
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <button
                      type="button"
                      role="menuitem"
                      className="tg-menu-item"
                      onClick={() => {
                        setEditing(true);
                        setMessage(null);
                      }}
                    >
                      {me.hasPin ? 'Change PIN' : 'Add a PIN'}
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    className="tg-menu-item"
                    onClick={() => {
                      setOpen(false);
                      void switchPlayer(clients.auth);
                    }}
                  >
                    Switch player
                  </button>
                  <hr className="tg-menu-divider" />
                </>
              )}
              <button
                type="button"
                role="menuitem"
                className="tg-menu-item"
                onClick={() => {
                  setOpen(false);
                  onFullScreen();
                }}
              >
                Full screen scoreboard
              </button>
              <button
                type="button"
                role="menuitem"
                className="tg-menu-item"
                onClick={() => {
                  setOpen(false);
                  onOpenRules();
                }}
              >
                How it works
              </button>
              {message && (
                <p className={message.ok ? 'tg-ok tg-small tg-menu-msg' : 'tg-error tg-small tg-menu-msg'} role="status">
                  {message.text}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </Slot>
  );
}
