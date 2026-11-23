import type { Answers } from '../../lib/thanksgiving/questions';
import { answerText, type Game, type Pick, type Player } from '../../lib/thanksgiving/view';

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
}

/** Everyone's picks side by side, shown from kickoff (docs/thanksgiving-spec.md, "Locking and reveal"). */
export function RevealTable({ game, picks, players, me }: Props) {
  if (picks === null) return <p className="muted">Loading everyone’s picks…</p>;
  const names = new Map(players.map((p) => [p.id, p.name]));
  const cols = picks
    .filter((p) => names.has(p.playerId))
    .sort((x, y) => (x.playerId === me?.id ? -1 : y.playerId === me?.id ? 1 : names.get(x.playerId)!.localeCompare(names.get(y.playerId)!)));
  if (cols.length === 0) return <p className="muted">Nobody made picks for this game.</p>;

  return (
    <div className="tg-reveal-wrap">
      <table className="tg-reveal" data-testid="tg-reveal">
        <caption>Everyone’s picks</caption>
        <thead>
          <tr>
            <th scope="col">Question</th>
            {cols.map((c) => (
              <th key={c.playerId} scope="col" className={c.playerId === me?.id ? 'tg-me' : undefined}>
                {names.get(c.playerId)}
                {c.playerId === me?.id ? ' (you)' : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => (
            <tr key={r.key}>
              <th scope="row">{r.label}</th>
              {cols.map((c) => (
                <td key={c.playerId}>{answerText(game, r.key, c.answers) || <span className="muted">—</span>}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
