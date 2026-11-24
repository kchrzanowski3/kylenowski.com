// Playful vintage Thanksgiving illustrations, rank medals (1st = The Turducken!),
// champion fanfare, Thanksgiving celebration burst, and 15/15 completion handoff.
import type { CSSProperties } from 'react';
import type { Game } from '../../lib/thanksgiving/view';

/**
 * Vintage rank medal for Standings and TV Mode:
 * - 1st place: The Turducken (gold rosette medal with roasted turducken + tiny crown)
 * - 2nd place: Vintage silver medal
 * - 3rd place: Harvest bronze medal
 * - 4th+: Crisp tabular rank number
 */
export function RankMedal({ rank, size = 28 }: { rank: number; size?: number }) {
  if (rank === 1) {
    return (
      <span className="tg-medal tg-medal-1" title="1st place — The Turducken!" aria-label="1st place, The Turducken">
        <svg width={size} height={size} viewBox="0 0 36 36" role="img" aria-hidden="true">
          {/* Crimson & gold ribbon tails */}
          <path d="M12 24 L9 35 L14.5 32 L17.5 35.5 L18 25 Z" fill="#a32737" />
          <path d="M24 24 L27 35 L21.5 32 L18.5 35.5 L18 25 Z" fill="#821c29" />
          {/* Scalloped gold rosette medal */}
          <circle cx="18" cy="15.5" r="12.5" fill="#e5a628" stroke="#8a5407" strokeWidth="1.5" />
          <circle cx="18" cy="15.5" r="10.2" fill="#f7cf6a" stroke="#b97710" strokeWidth="1" strokeDasharray="2.2 1.6" />
          {/* Little royal crown perched on top */}
          <path d="M13.5 8.5 L14.8 5.2 L18 7.3 L21.2 5.2 L22.5 8.5 Z" fill="#fff3c4" stroke="#8a5407" strokeWidth="0.9" strokeLinejoin="round" />
          {/* Golden roasted Turducken platter silhouette */}
          <ellipse cx="18" cy="21.2" rx="8.2" ry="2.1" fill="#fff8eb" stroke="#8a5407" strokeWidth="0.9" />
          <path
            d="M11.6 19.6 C11.4 13.8 14.2 11 18.2 11 C21.8 11 24.4 13.4 24.5 17.5 C24.5 19.2 23.4 20.2 21.8 20.2 H13.4 C12.3 20.2 11.6 19.9 11.6 19.6 Z"
            fill="#b85d19"
            stroke="#6e3208"
            strokeWidth="1.1"
          />
          {/* Gloss highlight + layered turducken slice curve */}
          <path d="M14.2 14.5 C15.6 13.1 18.2 12.8 19.8 13.7" fill="none" stroke="#f7cf6a" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M14.2 18 C16.2 16.9 19.2 17 21 18.2" fill="none" stroke="#ffd89c" strokeWidth="0.9" strokeLinecap="round" />
          {/* Drumstick bone with paper frill */}
          <path d="M23.2 16.5 L26.4 14.4" stroke="#fff8eb" strokeWidth="2.1" strokeLinecap="round" />
          <circle cx="26.7" cy="13.8" r="1.2" fill="#fff8eb" />
          <circle cx="27.2" cy="14.9" r="1.1" fill="#fff8eb" />
        </svg>
      </span>
    );
  }
  if (rank === 2) {
    return (
      <span className="tg-medal tg-medal-2" title="2nd place" aria-label="2nd place">
        <svg width={size - 2} height={size - 2} viewBox="0 0 32 32" role="img" aria-hidden="true">
          <circle cx="16" cy="16" r="13" fill="#cfd6dc" stroke="#5c6770" strokeWidth="1.5" />
          <circle cx="16" cy="16" r="10.2" fill="#e9eef2" stroke="#85929d" strokeWidth="1" />
          <text x="16" y="21" textAnchor="middle" fontFamily="'Barlow Condensed', sans-serif" fontWeight="800" fontSize="15" fill="#2d3748">2</text>
        </svg>
      </span>
    );
  }
  if (rank === 3) {
    return (
      <span className="tg-medal tg-medal-3" title="3rd place" aria-label="3rd place">
        <svg width={size - 2} height={size - 2} viewBox="0 0 32 32" role="img" aria-hidden="true">
          <circle cx="16" cy="16" r="13" fill="#c9885b" stroke="#744221" strokeWidth="1.5" />
          <circle cx="16" cy="16" r="10.2" fill="#e3ae85" stroke="#965a31" strokeWidth="1" />
          <text x="16" y="21" textAnchor="middle" fontFamily="'Barlow Condensed', sans-serif" fontWeight="800" fontSize="15" fill="#4a260f">3</text>
        </svg>
      </span>
    );
  }
  return <span className="tg-rank-num">{rank}</span>;
}

interface BurstPiece {
  kind: 'leaf' | 'football' | 'star';
  x: string;
  delay: string;
  dur: string;
  drift: string;
  rot: string;
  color: string;
  scale: number;
}

const BURST_PIECES: BurstPiece[] = [
  { kind: 'leaf', x: '6%', delay: '0s', dur: '1.9s', drift: '18px', rot: '220deg', color: '#b92b3a', scale: 1 },
  { kind: 'football', x: '13%', delay: '0.12s', dur: '2.1s', drift: '-14px', rot: '-190deg', color: '#8f471d', scale: 0.95 },
  { kind: 'star', x: '20%', delay: '0.04s', dur: '1.75s', drift: '12px', rot: '160deg', color: '#e3a528', scale: 0.9 },
  { kind: 'leaf', x: '27%', delay: '0.18s', dur: '2.2s', drift: '-22px', rot: '260deg', color: '#d96b27', scale: 1.05 },
  { kind: 'leaf', x: '34%', delay: '0.08s', dur: '1.95s', drift: '16px', rot: '-210deg', color: '#1b6d3d', scale: 0.9 },
  { kind: 'star', x: '42%', delay: '0.15s', dur: '1.85s', drift: '-10px', rot: '180deg', color: '#f0bc47', scale: 1 },
  { kind: 'football', x: '50%', delay: '0.02s', dur: '2.15s', drift: '20px', rot: '240deg', color: '#9a4b21', scale: 1 },
  { kind: 'leaf', x: '58%', delay: '0.1s', dur: '2.0s', drift: '-18px', rot: '-250deg', color: '#b92b3a', scale: 1.05 },
  { kind: 'star', x: '66%', delay: '0.2s', dur: '1.8s', drift: '14px', rot: '140deg', color: '#e3a528', scale: 0.85 },
  { kind: 'leaf', x: '73%', delay: '0.06s', dur: '2.25s', drift: '-16px', rot: '230deg', color: '#d96b27', scale: 0.95 },
  { kind: 'football', x: '81%', delay: '0.16s', dur: '2.05s', drift: '12px', rot: '-180deg', color: '#8f471d', scale: 0.95 },
  { kind: 'leaf', x: '88%', delay: '0.09s', dur: '1.9s', drift: '-20px', rot: '200deg', color: '#c98a1c', scale: 1 },
  { kind: 'star', x: '94%', delay: '0.14s', dur: '1.8s', drift: '-12px', rot: '-160deg', color: '#f0bc47', scale: 0.9 },
];

/**
 * Thanksgiving-themed celebration burst: fluttering autumn leaves, tiny laced footballs,
 * and golden pennant stars. Pure CSS/SVG, pointer-events: none, respects prefers-reduced-motion.
 */
export function HarvestBurst({ burstKey }: { burstKey: string | number }) {
  return (
    <div key={burstKey} className="tg-burst" aria-hidden="true">
      {BURST_PIECES.map((p, i) => (
        <span
          key={i}
          className="tg-burst-piece"
          style={
            {
              left: p.x,
              '--tg-delay': p.delay,
              '--tg-dur': p.dur,
              '--tg-drift': p.drift,
              '--tg-rot': p.rot,
              '--tg-scale': p.scale,
            } as CSSProperties
          }
        >
          {p.kind === 'leaf' ? (
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path
                d="M12 2 L14.4 7.5 L19.5 6.2 L16.8 11 L21 13.5 L15.5 15.8 L16.2 19 L12.8 17.5 V22 H11.2 V17.5 L7.8 19 L8.5 15.8 L3 13.5 L7.2 11 L4.5 6.2 L9.6 7.5 Z"
                fill={p.color}
              />
            </svg>
          ) : p.kind === 'football' ? (
            <svg width="20" height="14" viewBox="0 0 28 18">
              <ellipse cx="14" cy="9" rx="12" ry="7.5" fill={p.color} stroke="#fff8eb" strokeWidth="1.4" />
              <path d="M9.5 9 H18.5 M11.5 6.8 V11.2 M14 6.5 V11.5 M16.5 6.8 V11.2" stroke="#fff8eb" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 20 20">
              <path d="M10 1.5 L12.4 6.8 L18.2 7.4 L13.8 11.2 L15 17 L10 14 L5 17 L6.2 11.2 L1.8 7.4 L7.6 6.8 Z" fill={p.color} />
            </svg>
          )}
        </span>
      ))}
    </div>
  );
}

/** Big celebratory banner when a game finishes or the overall Thanksgiving Champion is crowned. */
export function ChampionBanner({
  title,
  names,
  testId,
}: {
  title: string;
  names: string;
  testId?: string;
}) {
  return (
    <div className="tg-champ-banner" data-testid={testId}>
      <HarvestBurst burstKey={`${title}-${names}`} />
      <RankMedal rank={1} size={42} />
      <div className="tg-champ-copy">
        <span className="tg-champ-label">{title}</span>
        <strong className="tg-champ-names">{names}</strong>
      </div>
    </div>
  );
}

/**
 * Celebratory completion card shown once all 15 picks for a game are answered,
 * with a seamless button to move on to the next unfinished open game.
 */
export function PicksCompleteCard({
  game,
  nextGame,
  nextAnswered,
  totalQuestions,
  justCompleted,
  onSelectGame,
}: {
  game: Game;
  nextGame: Game | null;
  nextAnswered: number;
  totalQuestions: number;
  justCompleted: boolean;
  onSelectGame?: (id: string) => void;
}) {
  return (
    <div className="tg-complete-card" data-testid="tg-picks-complete" role="status">
      {justCompleted && <HarvestBurst burstKey={`done-${game.id}`} />}
      <div className="tg-complete-head">
        <span className="tg-complete-stamp" aria-hidden="true">
          <svg width="28" height="28" viewBox="0 0 28 28">
            <circle cx="14" cy="14" r="12.5" fill="#165b33" stroke="#f0c368" strokeWidth="1.8" />
            <path d="M8.5 14.5 L12.2 18.2 L19.8 10.4" fill="none" stroke="#fff8eb" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <div>
          <strong className="tg-complete-title">
            All {totalQuestions} picks locked in for {game.away.abbr} @ {game.home.abbr}!
          </strong>
          <p className="tg-complete-sub">
            {nextGame
              ? 'You’re all set here — ready to knock out your next game before kickoff?'
              : 'Every open game is filled out. Sit back, grab some pie, and enjoy the games.'}
          </p>
        </div>
      </div>
      {nextGame && onSelectGame && (
        <button
          type="button"
          className="tg-next-game-btn"
          data-testid="tg-next-game"
          onClick={() => onSelectGame(nextGame.id)}
        >
          <span>
            Next up: {nextGame.away.abbr} @ {nextGame.home.abbr} ({nextAnswered}/{totalQuestions})
          </span>
          <span aria-hidden="true">→</span>
        </button>
      )}
    </div>
  );
}
