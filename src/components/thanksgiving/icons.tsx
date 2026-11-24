// Small inline icons (no icon font or image requests).
import { useState } from 'react';
import { teamLogo, type GamePhase } from '../../lib/thanksgiving/view';
import type { TeamInfo } from '../../lib/thanksgiving/types';

const PHASE_LABEL: Record<GamePhase, string> = { open: 'Open', live: 'Locked, in progress', final: 'Final' };

/** Open lock for a game still open for picks; a lock, green while the game is on and grey once it's over. */
export function LockIcon({ phase, size = 16 }: { phase: GamePhase; size?: number }) {
  return (
    <svg
      className={`tg-lock tg-lock-${phase}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label={PHASE_LABEL[phase]}
      data-phase={phase}
    >
      <rect x="4" y="10.5" width="16" height="11" rx="2.5" fill="currentColor" />
      <path
        d={phase === 'open' ? 'M8 10.5V7a4 4 0 0 1 7.8-1.3' : 'M8 10.5V7a4 4 0 0 1 8 0v3.5'}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg className={open ? 'tg-chevron tg-chevron-open' : 'tg-chevron'} width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 5l8 7-8 7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A team's logo from ESPN; hidden if it can't be loaded, since the abbreviation is always shown too. */
export function TeamLogo({ team, size = 28 }: { team: TeamInfo; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      className="tg-logo"
      src={teamLogo(team.abbr)}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
