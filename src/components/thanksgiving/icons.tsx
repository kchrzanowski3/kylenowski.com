// Small inline icons (no icon font or image requests).
import { useState } from 'react';
import { splitTeams, teamLogo, type GamePhase } from '../../lib/thanksgiving/view';
import type { TeamInfo } from '../../lib/thanksgiving/types';

/** Checkmark for finalized/banked points and completed games. */
export function CheckIcon({ size = 14, className, label }: { size?: number; className?: string; label?: string }) {
  return (
    <svg
      className={className ? `tg-icon ${className}` : 'tg-icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Hollow circle for live categories whose leader could still change. */
export function LiveCircleIcon({ size = 14, className, label }: { size?: number; className?: string; label?: string }) {
  return (
    <svg
      className={className ? `tg-icon ${className}` : 'tg-icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" strokeWidth="2.6" />
    </svg>
  );
}

/** Clock icon for open games (picks open before kickoff). */
export function ClockIcon({ size = 14, className, label }: { size?: number; className?: string; label?: string }) {
  return (
    <svg
      className={className ? `tg-icon ${className}` : 'tg-icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path d="M12 7.5v4.75l3 1.75" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Key icon for PIN-protected player accounts. */
export function KeyIcon({ size = 13, className, label }: { size?: number; className?: string; label?: string }) {
  return (
    <svg
      className={className ? `tg-icon ${className}` : 'tg-icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle cx="8.5" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path d="M12.5 12H21m-3.5 0v3m3.5-3v2.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const DEFAULT_PHASE_TEXT: Record<GamePhase, string> = { open: 'Open', live: 'Live', final: 'Final' };

/** Game phase indicator for tabs and headers: clock for open, pulsing LIVE badge for live, check for final. */
export function PhaseBadge({
  phase,
  text,
  compact = false,
  testId,
}: {
  phase: GamePhase;
  text?: string;
  compact?: boolean;
  testId?: string;
}) {
  const label = text ?? DEFAULT_PHASE_TEXT[phase];
  const iconSize = compact ? 11 : 13;
  return (
    <span
      className={compact ? `tg-phase-badge tg-phase-badge-${phase}` : `tg-phase tg-phase-${phase}`}
      data-phase={phase}
      data-testid={testId}
    >
      {phase === 'open' && <ClockIcon size={iconSize} />}
      {phase === 'live' && <span className="tg-live-dot" aria-hidden="true" />}
      {phase === 'final' && <CheckIcon size={iconSize} />}
      <span>{label}</span>
    </span>
  );
}

export function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg className={open ? 'tg-chevron tg-chevron-open' : 'tg-chevron'} width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 5l8 7-8 7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Downward arrow for "Next unanswered" / "Fix error" jump actions. */
export function ArrowDownIcon({ size = 14 }: { size?: number }) {
  return (
    <svg className="tg-icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14m-6-6l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
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
