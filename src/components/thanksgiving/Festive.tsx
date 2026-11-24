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
export function RankMedal({ rank, size = 32 }: { rank: number; size?: number }) {
  if (rank === 1) {
    return (
      <span className="tg-medal tg-medal-1" title="1st place — The Turducken!" aria-label="1st place, The Turducken">
        <svg width={size} height={size} viewBox="0 0 40 40" role="img" aria-hidden="true">
          {/* Serving platter */}
          <ellipse cx="20" cy="31.5" rx="17" ry="4.5" fill="#fff8eb" stroke="#7a4b06" strokeWidth="1.6" />
          <ellipse cx="20" cy="31.2" rx="13" ry="2.4" fill="#efe2c6" />
          {/* Little herb garnish sprigs on the platter */}
          <path d="M7.5 30.5 C6 28.5 8 27 9.8 28.6 C10.8 27 12.6 28.2 11.4 30.4 Z" fill="#1e7a44" />
          <path d="M29.2 30.6 C30.5 28.6 32.8 28.4 33 30.2 C31.8 31.4 30.2 31.4 29.2 30.6 Z" fill="#1e7a44" />
          {/* Plump golden-brown roasted Turducken body filling the frame */}
          <path
            d="M7 26.5 C6.5 16.5 12 11.5 19.5 11.5 C26.8 11.5 31.5 16 31.8 24 C32 27.6 29.5 29.5 25.5 29.5 H11.8 C8.5 29.5 7.2 28.4 7 26.5 Z"
            fill="#c2641a"
            stroke="#5e2a07"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          {/* Deep roasted belly shading */}
          <path
            d="M8.4 25.5 C9.5 27.8 12.5 28.4 25.2 28.4 C28.2 28.4 30.2 27.2 30.6 24.8 C27.5 26.4 13 26.8 8.4 25.5 Z"
            fill="#9b4810"
          />
          {/* Crispy golden roast gloss */}
          <path d="M11.5 16.8 C14 14 19 13.4 23.2 14.6" fill="none" stroke="#f7cb6b" strokeWidth="2.2" strokeLinecap="round" />
          {/* Playful tucked wing / turducken layer curve */}
          <path
            d="M11.5 24 C14.5 21 20.5 20.8 23.8 23.4 C21.2 25.5 14.8 25.8 11.5 24 Z"
            fill="#d97a26"
            stroke="#6e3208"
            strokeWidth="1.3"
          />
          {/* Big drumstick + bone + ruffled white paper frill */}
          <path
            d="M27.5 21.8 L34.2 16.2"
            stroke="#fffcf6"
            strokeWidth="3.6"
            strokeLinecap="round"
          />
          <path
            d="M27.5 21.8 L34.2 16.2"
            stroke="#7a4b06"
            strokeWidth="1.2"
            strokeLinecap="round"
            opacity="0.35"
          />
          <circle cx="34.8" cy="14.9" r="2.2" fill="#fffcf6" stroke="#7a4b06" strokeWidth="1.1" />
          <circle cx="36.2" cy="17.1" r="2.1" fill="#fffcf6" stroke="#7a4b06" strokeWidth="1.1" />
          {/* Little golden crown perched jauntily on top */}
          <path
            d="M13.5 11.8 L12.4 5.5 L16.8 8.6 L19.6 4 L22.4 8.6 L26.6 5.5 L25.4 11.8 Z"
            fill="#f5c249"
            stroke="#7a4b06"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <circle cx="19.6" cy="9.6" r="1.1" fill="#a32737" />
        </svg>
      </span>
    );
  }
  if (rank === 2) {
    return (
      <span className="tg-medal tg-medal-2" title="2nd place" aria-label="2nd place">
        <svg width={size - 4} height={size - 4} viewBox="0 0 32 32" role="img" aria-hidden="true">
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
        <svg width={size - 4} height={size - 4} viewBox="0 0 32 32" role="img" aria-hidden="true">
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
      <RankMedal rank={1} size={50} />
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
