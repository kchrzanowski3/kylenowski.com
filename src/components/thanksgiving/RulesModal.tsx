// Lightweight "How it works" rules dialog (docs/thanksgiving-spec.md): explains scoring,
// Live vs. Banked points, kickoff lock/reveal timing, and tiebreakers.
import { useEffect, useRef } from 'react';
import { CheckIcon, CloseIcon, LiveCircleIcon } from './icons';

export function RulesModal({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      prevFocus?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="tg-modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="tg-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tg-rules-title"
        data-testid="tg-rules-modal"
      >
        <header className="tg-modal-head">
          <h2 id="tg-rules-title">How it works</h2>
          <button
            ref={closeRef}
            type="button"
            className="tg-modal-close"
            aria-label="Close rules"
            onClick={onClose}
          >
            <CloseIcon size={18} />
          </button>
        </header>

        <div className="tg-modal-body">
          <section className="tg-rules-section">
            <h3>Scoring &amp; closest wins</h3>
            <ul>
              <li>
                <strong>15 questions per game</strong> across all 3 Thanksgiving games (up to 33 pts/game, or 37 with a
                safety).
              </li>
              <li>
                <strong>Exact picks:</strong> 1 pt each, <strong>3 pts</strong> for First TD scorer, and{' '}
                <strong>5 pts</strong> if the first score is a safety.
              </li>
              <li>
                <strong>Final score:</strong> <strong>3 pts</strong> for the closest guess (|away diff| + |home diff|),{' '}
                <strong>+1 pt</strong> for the winning team, and <strong>+1 pt</strong> if you’re within 15 total points.
              </li>
              <li>
                <strong>Stat totals (Q10–Q15):</strong> <strong>3 pts</strong> to the closest guess. Equally close
                guesses each earn the full 3 pts. Overtime counts for every stat except 4th-quarter lead change.
              </li>
            </ul>
          </section>

          <section className="tg-rules-section">
            <h3>Live vs. Banked points</h3>
            <ul>
              <li>
                <span className="tg-rules-tag tg-rules-tag-live">
                  <LiveCircleIcon size={12} /> Live
                </span>{' '}
                Your score if the game ended right now — banked points plus categories where you currently lead (can
                still swing).
              </li>
              <li>
                <span className="tg-rules-tag tg-rules-tag-banked">
                  <CheckIcon size={12} /> Banked
                </span>{' '}
                Finalized points from settled categories (first score, halftime leader, finished games) that can’t
                change.
              </li>
              <li>
                Standings sort by <strong>Live</strong> pace during active games; switch to <strong>Banked</strong>{' '}
                anytime to view guaranteed totals.
              </li>
            </ul>
          </section>

          <section className="tg-rules-section">
            <h3>Kickoff lock &amp; reveal</h3>
            <ul>
              <li>
                Each game locks separately at its scheduled kickoff — latecomers can still join and pick later games.
              </li>
              <li>
                Everyone’s picks stay hidden until kickoff, then reveal automatically. Skipped questions score 0.
              </li>
              <li>
                Official box-score stats update automatically (typically 15–45 seconds behind the broadcast).
              </li>
            </ul>
          </section>

          <section className="tg-rules-section">
            <h3>Tiebreakers &amp; champions</h3>
            <ul>
              <li>
                <strong>Per game:</strong> Most points in that game wins; ties share co-winner honors.
              </li>
              <li>
                <strong>Overall champion:</strong> Most points across all 3 games. Ties break by whose{' '}
                <strong>Game 3 final-score total</strong> (away + home) is closest to the actual Game 3 combined score;
                if still tied, co-champions share the crown.
              </li>
            </ul>
          </section>
        </div>

        <footer className="tg-modal-foot">
          <button type="button" className="tg-primary" onClick={onClose}>
            Got it
          </button>
        </footer>
      </div>
    </div>
  );
}
