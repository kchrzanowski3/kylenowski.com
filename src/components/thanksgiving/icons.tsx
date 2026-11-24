// Small inline icons (no icon font or image requests).
import { useState } from 'react';
import { splitTeams, teamLogo, type GamePhase } from '../../lib/thanksgiving/view';
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

/**
 * A team's logo from ESPN. Where the abbreviation is shown next to it, the logo is decorative and is
 * hidden if it can't be loaded; with `standIn`, the logo stands in for the abbreviation (its alt
 * text), which is shown instead if the logo can't be loaded.
 */
export function TeamLogo({ team, size = 28, standIn = false }: { team: TeamInfo; size?: number; standIn?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed) return standIn ? <span className="tg-logo-fallback">{team.abbr}</span> : null;
  return (
    <img
      className="tg-logo"
      src={teamLogo(team.abbr)}
      alt={standIn ? team.abbr : ''}
      title={standIn ? team.name : undefined}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

/** Text with the game's team abbreviations ("CIN 17 – WSH 19", "WSH ahead") shown as logos. */
export function TeamText({ text, teams, size = 22 }: { text: string; teams: TeamInfo[]; size?: number }) {
  const byAbbr = new Map(teams.map((t) => [t.abbr, t]));
  return (
    <span className="tg-team-text">
      {splitTeams(text, teams.map((t) => t.abbr)).map((part, i) =>
        'team' in part ? <TeamLogo key={i} team={byAbbr.get(part.team)!} size={size} standIn /> : <span key={i}>{part.text}</span>,
      )}
    </span>
  );
}
