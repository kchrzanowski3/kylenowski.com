import { FirebaseError } from 'firebase/app';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Clients } from '../../lib/thanksgiving/client';
import {
  FINAL_SCORE_MAX,
  NUMBER_QUESTIONS,
  QUESTION_COUNT,
  answerProblems,
  answeredCount,
  compactAnswers,
  savableAnswers,
  type Answers,
} from '../../lib/thanksgiving/questions';
import type { ScorerPosition, Side, TeamAverages } from '../../lib/thanksgiving/types';
import type { Game, Player } from '../../lib/thanksgiving/view';

interface Props {
  clients: Clients;
  game: Game;
  me: Player;
  saved: Answers | null;
  now: number;
}

type Status = { kind: 'idle' | 'saving' | 'saved' } | { kind: 'error' | 'invalid'; text: string };

export function PickForm({ clients, game, me, saved }: Props) {
  const [draft, setDraft] = useState<Answers>(() => saved ?? {});
  const [status, setStatus] = useState<Status>({ kind: saved ? 'saved' : 'idle' });
  const pending = useRef<Answers | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  async function save(answers: Answers, note: string | null = null) {
    pending.current = null;
    setStatus({ kind: 'saving' });
    try {
      await setDoc(doc(clients.db, `tgGames/${game.id}/picks/${me.id}`), {
        answers,
        updatedAt: serverTimestamp(),
      });
      setStatus(note ? { kind: 'invalid', text: note } : { kind: 'saved' });
    } catch (e) {
      const locked = e instanceof FirebaseError && e.code === 'permission-denied';
      setStatus({ kind: 'error', text: locked ? 'Not saved: picks for this game are locked.' : `Not saved: ${String(e)}` });
    }
  }

  // Save a moment after the last change, and right away if the form goes away.
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (pending.current) void save(pending.current);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  function update<K extends keyof Answers>(key: K, value: Answers[K] | undefined) {
    const next = { ...draft, [key]: value };
    setDraft(next);
    const answers = compactAnswers(next as Record<string, unknown>);
    const problems = answerProblems(answers as Record<string, unknown>);
    clearTimeout(timer.current);
    // With a problem in one answer, still save all the others.
    const toSave = problems.length > 0 ? savableAnswers(answers) : answers;
    const note = problems.length > 0 ? friendly(problems[0]) : null;
    pending.current = toSave;
    setStatus({ kind: 'saving' });
    timer.current = setTimeout(() => void save(toSave, note), 600);
  }

  const a = draft;
  const away = game.away.abbr;
  const home = game.home.abbr;
  const sides: [Side, string][] = [['away', away], ['home', home]];
  const sidesTie: [string, string][] = [['away', away], ['tie', 'Tie'], ['home', home]];
  const count = answeredCount(compactAnswers(a as Record<string, unknown>));

  return (
    <form className="tg-picks" onSubmit={(e) => e.preventDefault()} aria-label={`Your picks for ${away} @ ${home}`}>
      <div className="tg-save" role="status" data-testid="tg-save-status">
        <span>{count} of {QUESTION_COUNT} answered</span>
        <span className={`tg-save-${status.kind}`}>{statusText(status)}</span>
      </div>

      <Question n={1} title="Final score" points="3 closest · +1 right winner · +1 within 15" help={averagesText(game, 'points', 'points per game')}>
        <div className="tg-score">
          {sides.map(([side, abbr]) => {
            const key = side === 'away' ? 'finalAway' : 'finalHome';
            return (
              <label key={side} className="tg-score-team">
                <span>{abbr}</span>
                <NumberInput value={a[key]} max={FINAL_SCORE_MAX} label={`${abbr} final score`} onChange={(v) => update(key, v)} />
              </label>
            );
          })}
        </div>
        <p className="muted tg-small">Can't be a tie.</p>
      </Question>

      <Question n={2} title="Which team scores first?" points="1">
        <Choice options={sides} value={a.firstTeam} onChange={(v) => update('firstTeam', v as Side | undefined)} />
      </Question>

      <Question n={3} title="How is the first score made?" points="1 · 5 for a safety">
        <Choice
          options={[['td', 'TD'], ['fg', 'FG'], ['safety', 'Safety']]}
          value={a.firstScoreType}
          onChange={(v) => update('firstScoreType', v as Answers['firstScoreType'])}
        />
      </Question>

      <Question n={4} title="First TD scorer" points="3">
        <ScorerSelect game={game} value={a.firstTdScorer} onChange={(v) => update('firstTdScorer', v)} />
      </Question>

      <Question n={5} title="Who's leading at halftime?" points="1">
        <Choice options={sidesTie} value={a.halftime} onChange={(v) => update('halftime', v as Answers['halftime'])} />
      </Question>

      <Question n={6} title="Which team has more passing TDs?" points="1">
        <Choice options={sidesTie} value={a.passTds} onChange={(v) => update('passTds', v as Answers['passTds'])} />
      </Question>

      <Question n={7} title="Which team has more rushing TDs?" points="1">
        <Choice options={sidesTie} value={a.rushTds} onChange={(v) => update('rushTds', v as Answers['rushTds'])} />
      </Question>

      <Question n={8} title="Missed extra point or field goal?" points="1" note="Any missed or blocked kick. A failed 2-point try doesn't count.">
        <YesNo value={a.missedKick} onChange={(v) => update('missedKick', v)} />
      </Question>

      <Question n={9} title="Lead change in the 4th quarter?" points="1" note="Yes if a team goes ahead when it was tied or behind. Overtime doesn't count.">
        <YesNo value={a.leadChange4q} onChange={(v) => update('leadChange4q', v)} />
      </Question>

      {NUMBER_QUESTIONS.map((q, i) => (
        <Question key={q.key} n={10 + i} title={q.label} points="3 closest" note={q.hint} help={averagesText(game, q.avg, `${q.unit} per game`)}>
          <NumberInput value={a[q.key]} max={q.max} label={q.label} onChange={(v) => update(q.key, v)} />
        </Question>
      ))}
    </form>
  );
}

function statusText(s: Status): string {
  switch (s.kind) {
    case 'idle':
      return 'Nothing saved yet';
    case 'saving':
      return 'Saving…';
    case 'saved':
      return 'Saved ✓';
    default:
      return s.text;
  }
}

function friendly(problem: string): string {
  if (problem.includes('needs both')) return 'Saved, except the final score: enter both teams’ scores.';
  if (problem.includes('tie')) return 'Saved, except the final score: it can’t be a tie.';
  return `Saved, except: ${problem}.`;
}

/** "CHI 1.8 · DET 2.1 field goals made per game (each team's own) · NFL average 1.9 per team". */
function averagesText(game: Game, field: keyof Omit<TeamAverages, 'games'>, unit: string): ReactNode {
  const { away, home, nfl } = game.averages;
  if (!away && !home && !nfl) return null;
  const parts: string[] = [];
  if (away) parts.push(`${game.away.abbr} ${away[field]}`);
  if (home) parts.push(`${game.home.abbr} ${home[field]}`);
  return (
    <>
      {parts.length > 0 && (
        <>
          {parts.join(' · ')} {unit} <span className="muted">(each team’s own)</span>
        </>
      )}
      {nfl && (
        <>
          {parts.length > 0 ? ' · ' : ''}NFL average {nfl[field]} per team
        </>
      )}
    </>
  );
}

function Question(props: { n: number; title: string; points: string; note?: string; help?: ReactNode; children: ReactNode }) {
  return (
    <fieldset className="tg-q">
      <legend>
        <span className="tg-q-n">{props.n}</span> {props.title} <span className="tg-q-pts">{props.points}</span>
      </legend>
      {props.note && <p className="muted tg-small">{props.note}</p>}
      {props.children}
      {props.help && <p className="tg-help tg-small">{props.help}</p>}
    </fieldset>
  );
}

function Choice(props: { options: [string, string][]; value: string | undefined; onChange: (v: string | undefined) => void }) {
  return (
    <div className="tg-choice" role="group">
      {props.options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          aria-pressed={props.value === v}
          onClick={() => props.onChange(props.value === v ? undefined : v)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function YesNo(props: { value: boolean | undefined; onChange: (v: boolean | undefined) => void }) {
  const value = props.value === undefined ? undefined : props.value ? 'yes' : 'no';
  return (
    <Choice
      options={[['yes', 'Yes'], ['no', 'No']]}
      value={value}
      onChange={(v) => props.onChange(v === undefined ? undefined : v === 'yes')}
    />
  );
}

function NumberInput(props: { value: number | undefined; max: number; label: string; onChange: (v: number | undefined) => void }) {
  return (
    <input
      className="tg-number"
      type="number"
      inputMode="numeric"
      min={0}
      max={props.max}
      step={1}
      aria-label={props.label}
      value={props.value ?? ''}
      onChange={(e) => {
        const raw = e.target.value.trim();
        if (raw === '') return props.onChange(undefined);
        const n = Number(raw);
        props.onChange(Number.isFinite(n) ? n : undefined);
      }}
    />
  );
}

const POS_ORDER: ScorerPosition[] = ['QB', 'RB', 'WR', 'TE'];

function ScorerSelect(props: { game: Game; value: string | undefined; onChange: (v: string | undefined) => void }) {
  const { game } = props;
  const listed = props.value === undefined || props.value === 'other' || props.value === 'none' || game.scorers.some((s) => s.id === props.value);
  return (
    <select
      className="tg-select"
      aria-label="First TD scorer"
      value={props.value ?? ''}
      onChange={(e) => props.onChange(e.target.value === '' ? undefined : e.target.value)}
    >
      <option value="">Pick a player…</option>
      {(['away', 'home'] as const).map((side) => (
        <optgroup key={side} label={game[side].name}>
          {game.scorers
            .filter((s) => s.side === side)
            .sort((x, y) => POS_ORDER.indexOf(x.pos) - POS_ORDER.indexOf(y.pos))
            .map((s) => (
              <option key={`${side}-${s.id}`} value={s.id}>
                {s.name} ({s.pos})
              </option>
            ))}
        </optgroup>
      ))}
      <optgroup label="Anyone else">
        <option value="other">Other player (defense, special teams, backups…)</option>
        <option value="none">No TD in the game</option>
      </optgroup>
      {!listed && <option value={props.value}>A player no longer listed (won't score)</option>}
    </select>
  );
}
