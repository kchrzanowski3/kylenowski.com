// One player's picks for a game, shown from kickoff (docs/thanksgiving-spec.md, "Locking and reveal"
// and "Page layout"): pick a player from the list to see their 15 answers and the points each is
// earning. Starts on you.
import { useState } from 'react';
import type { Answers } from '../../lib/thanksgiving/questions';
import type { GameScore } from '../../lib/thanksgiving/scoring';
import { answerText, defaultPickerPlayer, pickerPlayers, rowPoints, type Game, type Pick, type Player } from '../../lib/thanksgiving/view';

const ROWS: { key: keyof Answers | 'final'; label: string }[] = [
  { key: 'final', label: 'Final score' },
  { key: 'firstTeam', label: 'Scores first' },
  { key: 'firstScoreType', label: 'First score by' },
  { key: 'firstTdScorer', label: 'First TD scorer' },
  { key: 'halftime', label: 'Halftime leader' },
  { key: 'passTds', label: 'More passing TDs' },
  { key: 'rushTds', label: 'More rushing TDs' },
  { key: 'missedKick', label: 'Missed XP or FG' },
  { key: 'leadChange4q', label: '4th-quarter lead change' },
  { key: 'fgs', label: 'Total FGs made' },
  { key: 'punts', label: 'Total punts' },
  { key: 'tds', label: 'Total TDs' },
  { key: 'turnovers', label: 'Combined turnovers' },
  { key: 'longestTd', label: 'Longest TD (yards)' },
  { key: 'sacks', label: 'Combined sacks' },
];

interface Props {
  game: Game;
  picks: Pick[] | null;
  players: Player[];
  me: Player | null;
  score: GameScore | null;
}

export function PlayerPicks({ game, picks, players, me, score }: Props) {
  const [chosen, setChosen] = useState<string | null>(null);
  if (picks === null) return <p className="muted">Loading picks…</p>;
  const names = new Map(players.map((p) => [p.id, p.name]));
  const byPlayer = new Map(picks.filter((p) => names.has(p.playerId)).map((p) => [p.playerId, p.answers]));
  const others = [...byPlayer.keys()].sort((a, b) => names.get(a)!.localeCompare(names.get(b)!));
  const ids = pickerPlayers(others, me?.id ?? null);
  if (ids.length === 0) return <p className="muted">No picks for this game.</p>;

  const current = chosen && ids.includes(chosen) ? chosen : defaultPickerPlayer(ids, me?.id ?? null, score?.totals)!;
  const answers = byPlayer.get(current) ?? null;
  const live = score?.status === 'live';
  const scored = !!score && score.status !== 'pre';
  const total = score?.totals[current] ?? 0;

  return (
    <section className="tg-picks" data-testid="tg-reveal" aria-label="Picks">
      <div className="tg-picks-head">
        <select
          className="tg-select"
          aria-label="Player"
          data-testid="tg-reveal-player"
          value={current}
          onChange={(e) => setChosen(e.target.value)}
        >
          {ids.map((id) => (
            <option key={id} value={id}>
              {names.get(id) ?? me?.name}{id === me?.id ? ' (you)' : ''}
            </option>
          ))}
        </select>
        {scored && (
          <strong className={live ? 'tg-points tg-projected' : 'tg-points'} data-testid="tg-reveal-total">
            {total} pts
          </strong>
        )}
      </div>
      {answers === null ? (
        <p className="muted">No picks for this game.</p>
      ) : (
      <ul className="tg-pick-list">
        {ROWS.map((r) => {
          const text = answerText(game, r.key, answers);
          const pts = scored ? rowPoints(score!.categories, r.key, current) : 0;
          return (
            <li key={r.key} className={pts > 0 ? 'tg-pick-row tg-pick-hit' : 'tg-pick-row'}>
              <span className="tg-pick-q">{r.label}</span>
              <span className="tg-pick-a">{text || <span className="muted">—</span>}</span>
              <span className={live ? 'tg-pick-pts tg-projected' : 'tg-pick-pts'}>{pts > 0 ? `+${pts}` : ''}</span>
            </li>
          );
        })}
      </ul>
      )}
    </section>
  );
}
