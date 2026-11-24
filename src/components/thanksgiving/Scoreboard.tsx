import { useState } from 'react';
import type { CategoryResult, GameScore } from '../../lib/thanksgiving/scoring';
import type { GameStats } from '../../lib/thanksgiving/stats';
import {
  CATEGORY_SHORT,
  categoryPicks,
  whoCount,
  worthBadge,
  type Game,
  type Pick,
  type Player,
} from '../../lib/thanksgiving/view';
import { ChampionBanner } from './Festive';
import { CheckIcon, LiveCircleIcon } from './icons';
import { PlayerPicks } from './PlayerPicks';

export interface GameResult {
  stats: GameStats;
  score: GameScore;
}

/** "Q3 5:00", "Halftime", "Final", "Final/OT". */
export function gameClock(s: GameStats): string {
  if (s.state === 'pre') return 'Not started';
  if (s.state === 'post') return s.period > 4 ? 'Final/OT' : 'Final';
  if (s.halftimeReached && s.period <= 2) return 'Halftime';
  const q = s.period > 4 ? 'OT' : `Q${s.period}`;
  return s.clock ? `${q} ${s.clock}` : q;
}

interface Props {
  game: Game;
  result: GameResult | null;
  picks: Pick[] | null;
  players: Player[];
  me: Player | null;
}

/**
 * Per-game scoreboard (docs/thanksgiving-spec.md, "Standings → Per-game scoreboard" and "Page layout").
 * Consolidates the chosen player's picks and the category-by-category board behind two sub-tabs so
 * live games stay compact and scannable on mobile.
 */
export function Scoreboard({ game, result, picks, players, me }: Props) {
  const [view, setView] = useState<'picks' | 'categories'>('picks');

  if (!result || result.score.status === 'pre') {
    return (
      <>
        <p className="muted">The scoreboard starts when the feed shows the game under way.</p>
        <PlayerPicks game={game} picks={picks} players={players} me={me} score={null} />
      </>
    );
  }
  const { score } = result;
  const names = new Map(players.map((p) => [p.id, p.name]));
  const who = (ids: string[]) => ids.map((id) => names.get(id)).filter(Boolean).join(', ') || '—';

  return (
    <div className="tg-scoreboard" data-testid="tg-scoreboard">
      {score.winners.length > 0 && (
        <ChampionBanner
          title={score.winners.length > 1 ? 'Game winners' : 'Game winner'}
          names={who(score.winners)}
        />
      )}
      <div className="tg-subtabs" role="tablist" aria-label="Game details" data-testid="tg-game-subtabs">
        <button
          type="button"
          role="tab"
          className="tg-subtab"
          aria-selected={view === 'picks'}
          data-testid="tg-subtab-picks"
          onClick={() => setView('picks')}
        >
          {me ? 'My Picks' : 'Picks'}
        </button>
        <button
          type="button"
          role="tab"
          className="tg-subtab"
          aria-selected={view === 'categories'}
          data-testid="tg-subtab-categories"
          onClick={() => setView('categories')}
        >
          By Category
        </button>
      </div>

      {view === 'picks' ? (
        <PlayerPicks game={game} picks={picks} players={players} me={me} score={score} />
      ) : (
        <section aria-labelledby={`tg-cats-${game.id}`}>
          <h3 id={`tg-cats-${game.id}`} className="tg-sr-only">Who's getting points this game</h3>
          <ul className="tg-cats">
            {score.categories.map((c) => (
              <CategoryRow
                key={c.key}
                game={game}
                c={c}
                picks={picks}
                players={players}
                names={names}
                meId={me?.id ?? null}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** One category: short name, worth, current value, who's right (a count) and a banked/live mark. Tap for everyone's picks. */
function CategoryRow({
  game,
  c,
  picks,
  players,
  names,
  meId,
}: {
  game: Game;
  c: CategoryResult;
  picks: Pick[] | null;
  players: Player[];
  names: Map<string, string>;
  meId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const right = Object.keys(c.points).filter((id) => names.has(id));
  const mine = meId !== null && right.includes(meId);
  const final = c.status === 'final';
  const rowTone = mine ? (final ? 'tg-cat tg-cat-banked' : 'tg-cat tg-cat-lead') : 'tg-cat';
  const allPicks = open ? categoryPicks(game, c, picks, players, meId) : [];

  return (
    <li className={rowTone} data-testid={`tg-cat-${c.key}`}>
      <button type="button" className="tg-cat-row" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="tg-cat-name">
          <span className="tg-cat-label">
            {CATEGORY_SHORT[c.key]} <span className="tg-worth" aria-label={`worth ${c.worth}`}>{worthBadge(c.worth)}</span>
          </span>
          <span className="tg-cat-value">{c.answer}</span>
        </span>
        <span
          className={
            right.length === 0
              ? 'tg-cat-who muted'
              : final
                ? 'tg-cat-who tg-board-locked'
                : 'tg-cat-who tg-live-points tg-projected'
          }
        >
          {whoCount(right, names, meId)}
        </span>
        {final ? (
          <CheckIcon className="tg-mark tg-mark-final" size={16} label="Banked (final)" />
        ) : (
          <LiveCircleIcon
            className={mine ? 'tg-mark tg-mark-live tg-live-points' : 'tg-mark tg-mark-live'}
            size={16}
            label="Live (could still change)"
          />
        )}
      </button>
      {open && (
        <div className="tg-cat-expanded">
          <dl className="tg-cat-details">
            <dt>Category</dt>
            <dd>{c.label}</dd>
            <dt>Worth</dt>
            <dd>{c.worth}</dd>
            <dt>{final ? 'Final' : 'So far'}</dt>
            <dd>{c.answer}</dd>
            <dt>Status</dt>
            <dd>
              <span className={final ? 'tg-badge tg-badge-final' : 'tg-badge tg-badge-live'}>
                {final ? 'Banked (final)' : 'Live (could still change)'}
              </span>
            </dd>
          </dl>
          <div className="tg-cat-picks-wrap" data-testid={`tg-cat-picks-${c.key}`}>
            <p className="tg-cat-picks-title">Everyone’s picks</p>
            {picks === null ? (
              <p className="muted tg-small">Loading picks…</p>
            ) : allPicks.length === 0 ? (
              <p className="muted tg-small">No picks for this game.</p>
            ) : (
              <ul className="tg-cat-picks">
                {allPicks.map((entry) => {
                  const earned = entry.points > 0;
                  const tone = earned
                    ? final
                      ? 'tg-cat-pick tg-cat-pick-banked'
                      : 'tg-cat-pick tg-cat-pick-lead'
                    : 'tg-cat-pick';
                  return (
                    <li key={entry.playerId} className={entry.isMe ? `${tone} tg-cat-pick-me` : tone}>
                      <span className="tg-cat-pick-name">
                        {entry.name}
                        {entry.isMe ? ' (you)' : ''}
                      </span>
                      <span className="tg-cat-pick-val">{entry.pick || <span className="muted">—</span>}</span>
                      <span className="tg-cat-pick-pts">
                        {earned && final && <CheckIcon size={11} />}
                        {earned ? `+${entry.points}` : ''}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
