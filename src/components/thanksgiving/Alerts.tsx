// Notification UI for TV view (persistent Last Big Play strip) and mobile (personalized toast
// plus a collapsible Recent updates catch-up strip).
import { useState } from 'react';
import { formatAlertNames, type GameAlert, type MobileAlert } from '../../lib/thanksgiving/alerts';
import type { Game } from '../../lib/thanksgiving/view';
import { BellIcon, CheckIcon, ChevronIcon, CloseIcon, LiveCircleIcon, TeamText } from './icons';

function relativeAge(at: number, now: number): string {
  const sec = Math.max(0, Math.floor((now - at) / 1000));
  if (sec < 30) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

/**
 * Persistent "Last Big Play" strip rendered below the TV scoreboard header.
 * Stays visible until replaced by the next big play; re-animates via key={alert.id}.
 */
export function TvPlayStrip({
  alert,
  game,
  names,
}: {
  alert: GameAlert;
  game: Game;
  names: ReadonlyMap<string, string>;
}) {
  const tone = alert.kind === 'final' ? 'final' : alert.banked.length > 0 ? 'banked' : alert.kind === 'scoring' ? 'scoring' : 'swing';
  const bankedShown = alert.banked.slice(0, 3);
  const bankedExtra = alert.banked.length - bankedShown.length;
  // Cap total chips so the strip stays crisp from across the room.
  const leadCap = Math.max(1, 4 - bankedShown.length);
  const leadingShown = alert.leading.slice(0, leadCap);
  const leadingExtra = alert.leading.length - leadingShown.length;

  const gameWinnerNames = alert.gameWinners ? formatAlertNames(alert.gameWinners.playerIds, names, 3) : null;
  const overallNames = alert.standingsLead ? formatAlertNames(alert.standingsLead.newLeaders, names, 2) : null;

  return (
    <section
      key={alert.id}
      className={`tg-tv-strip tg-tv-strip-${tone}`}
      role="status"
      aria-live="polite"
      data-testid="tg-tv-play-strip"
    >
      <div className="tg-tv-strip-top">
        <span className={`tg-tv-strip-tag tg-tv-strip-tag-${tone}`}>{alert.tag}</span>
        <strong className="tg-tv-strip-headline">
          <TeamText text={alert.headline} teams={[game.away, game.home]} size={20} />
        </strong>
        {alert.subhead && <span className="tg-tv-strip-sub">{alert.subhead}</span>}
      </div>

      {(bankedShown.length > 0 || leadingShown.length > 0 || gameWinnerNames || overallNames) && (
        <div className="tg-tv-strip-impacts">
          {gameWinnerNames && alert.gameWinners && (
            <span className="tg-tv-chip tg-tv-chip-gold">
              <CheckIcon size={13} />
              <strong>{alert.gameWinners.playerIds.length > 1 ? 'Game co-winners' : 'Game winner'}:</strong> {gameWinnerNames} ({alert.gameWinners.points} pts)
            </span>
          )}
          {overallNames && alert.standingsLead && (
            <span className="tg-tv-chip tg-tv-chip-gold">
              <strong>
                {alert.standingsLead.isChampion
                  ? alert.standingsLead.newLeaders.length > 1
                    ? 'Co-champions'
                    : 'Champion'
                  : '1st overall'}
                :
              </strong>{' '}
              {overallNames}
            </span>
          )}
          {bankedShown.map((item) => (
            <span key={`b-${item.categoryKey}`} className="tg-tv-chip tg-tv-chip-banked">
              <CheckIcon size={13} />
              <strong>{item.label}</strong> (+{item.points}): {formatAlertNames(item.winners, names)}
            </span>
          ))}
          {bankedExtra > 0 && <span className="tg-tv-chip tg-tv-chip-banked">+{bankedExtra} more banked</span>}
          {leadingShown.map((item) => (
            <span key={`l-${item.categoryKey}`} className="tg-tv-chip tg-tv-chip-live">
              <LiveCircleIcon size={13} />
              <strong>{item.label}</strong> (+{item.points}): {formatAlertNames(item.winners, names)}
            </span>
          ))}
          {leadingExtra > 0 && <span className="tg-tv-chip tg-tv-chip-live">+{leadingExtra} more leading</span>}
        </div>
      )}
    </section>
  );
}

/** Personalized mobile bottom toast for banked points, new leads, and Game Final. */
export function MobileAlertToast({
  alert,
  onDismiss,
  onSelectGame,
}: {
  alert: MobileAlert;
  onDismiss: () => void;
  onSelectGame?: (gameId: string) => void;
}) {
  return (
    <div
      key={alert.id}
      className={`tg-alert-toast tg-alert-toast-${alert.tone}`}
      role="status"
      aria-live="polite"
      data-testid="tg-mobile-alert-toast"
    >
      <button
        type="button"
        className="tg-alert-toast-body"
        onClick={() => {
          onSelectGame?.(alert.gameId);
          onDismiss();
        }}
      >
        <span className="tg-alert-toast-meta">
          <span className={`tg-alert-dot tg-alert-dot-${alert.tone}`} aria-hidden="true">
            {alert.tone === 'live' ? <LiveCircleIcon size={12} /> : <CheckIcon size={12} />}
          </span>
          <span className="tg-alert-toast-tag">{alert.tag}</span>
          <span className="tg-alert-toast-headline">{alert.headline}</span>
        </span>
        <span className="tg-alert-toast-impact">{alert.impact}</span>
      </button>
      {alert.badge && <span className={`tg-alert-badge tg-alert-badge-${alert.tone}`}>{alert.badge}</span>}
      <button type="button" className="tg-toast-dismiss" aria-label="Dismiss notification" onClick={onDismiss}>
        <CloseIcon size={14} />
      </button>
    </div>
  );
}

/** Collapsible "Recent updates" strip on mobile so players can catch up after unlocking their phone. */
export function RecentUpdatesStrip({
  alerts,
  now,
  onSelectGame,
  onClear,
}: {
  alerts: readonly MobileAlert[];
  now: number;
  onSelectGame?: (gameId: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (alerts.length === 0) return null;
  const latest = alerts[0];

  return (
    <section className="tg-recent" aria-label="Recent updates" data-testid="tg-recent-updates">
      <button
        type="button"
        className="tg-recent-bar"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        data-testid="tg-recent-toggle"
      >
        <span className={`tg-recent-icon tg-recent-icon-${latest.tone}`}>
          <BellIcon size={14} />
        </span>
        <span className="tg-recent-preview">
          <strong>{latest.tag}:</strong> {latest.impact}
        </span>
        <span className="tg-recent-count" aria-label={`${alerts.length} recent updates`}>
          {alerts.length}
        </span>
        <ChevronIcon open={open} />
      </button>
      {open && (
        <div className="tg-recent-panel">
          <ul className="tg-recent-list">
            {alerts.map((a) => (
              <li key={a.id} className={`tg-recent-item tg-recent-item-${a.tone}`}>
                <button
                  type="button"
                  className="tg-recent-item-btn"
                  onClick={() => {
                    onSelectGame?.(a.gameId);
                    setOpen(false);
                  }}
                >
                  <span className="tg-recent-item-top">
                    <span className={`tg-recent-pill tg-recent-pill-${a.tone}`}>{a.tag}</span>
                    <span className="tg-recent-item-headline">{a.headline}</span>
                    <span className="tg-recent-item-age">{relativeAge(a.at, now)}</span>
                  </span>
                  <span className="tg-recent-item-bottom">
                    <span className="tg-recent-item-impact">{a.impact}</span>
                    {a.badge && <span className={`tg-alert-badge tg-alert-badge-${a.tone}`}>{a.badge}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="tg-recent-foot">
            <button type="button" className="tg-recent-clear" onClick={onClear}>
              Clear updates
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
