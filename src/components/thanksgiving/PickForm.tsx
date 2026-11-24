import { FirebaseError } from 'firebase/app';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Clients } from '../../lib/thanksgiving/client';
import {
  FINAL_SCORE_MAX,
  NUMBER_QUESTIONS,
  QUESTION_COUNT,
  QUESTION_SECTIONS,
  answerProblemDetails,
  answeredCount,
  compactAnswers,
  isQuestionAnswered,
  savableAnswers,
  type AnswerProblem,
  type Answers,
  type QuestionKey,
} from '../../lib/thanksgiving/questions';
import type { ScorerPosition, Side } from '../../lib/thanksgiving/types';
import { averageHint, stepperDefault, type Game, type Player } from '../../lib/thanksgiving/view';
import { formatPoints } from '../../lib/thanksgiving/projection';
import { PicksCompleteCard } from './Festive';
import { ArrowDownIcon, CheckIcon } from './icons';

interface Props {
  clients: Clients;
  game: Game;
  me: Player;
  saved: Answers | null;
  now: number;
  nextGame?: Game | null;
  nextAnswered?: number;
  onSelectGame?: (id: string) => void;
}

type Status = { kind: 'idle' | 'saving' | 'saved' } | { kind: 'error' | 'invalid'; text: string };

const QUESTION_ORDER: readonly QuestionKey[] = QUESTION_SECTIONS.flatMap((s) => [...s.questions]);

export function PickForm({ clients, game, me, saved, nextGame = null, nextAnswered = 0, onSelectGame }: Props) {
  const [draft, setDraft] = useState<Answers>(() => saved ?? {});
  const [status, setStatus] = useState<Status>({ kind: saved ? 'saved' : 'idle' });
  const [justCompleted, setJustCompleted] = useState(false);
  const [flashed, setFlashed] = useState<QuestionKey | null>(null);
  const pending = useRef<Answers | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const questionRefs = useRef<Partial<Record<QuestionKey, HTMLFieldSetElement | null>>>({});
  const lastJumped = useRef<QuestionKey | null>(null);

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
      clearTimeout(flashTimer.current);
      if (pending.current) void save(pending.current);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  function update<K extends keyof Answers>(key: K, value: Answers[K] | undefined) {
    const prevCompact = compactAnswers(draft as Record<string, unknown>);
    const prevProblems = answerProblemDetails(prevCompact as Record<string, unknown>);
    const prevValidCount = answeredCount(prevProblems.length > 0 ? savableAnswers(prevCompact) : prevCompact);

    const next = { ...draft, [key]: value };
    setDraft(next);
    const answers = compactAnswers(next as Record<string, unknown>);
    const problems = answerProblemDetails(answers as Record<string, unknown>);
    // With a problem in one answer, still save all the others.
    const toSave = problems.length > 0 ? savableAnswers(answers) : answers;
    const nextValidCount = answeredCount(toSave);

    if (prevValidCount < QUESTION_COUNT && nextValidCount === QUESTION_COUNT && problems.length === 0) {
      setJustCompleted(true);
    } else if (nextValidCount < QUESTION_COUNT || problems.length > 0) {
      setJustCompleted(false);
    }

    clearTimeout(timer.current);
    const note = problems.length > 0 ? friendly(problems) : null;
    pending.current = toSave;
    setStatus({ kind: 'saving' });
    timer.current = setTimeout(() => void save(toSave, note), 600);
  }

  const a = draft;
  const away = game.away.abbr;
  const home = game.home.abbr;
  const sides: [Side, string][] = [['away', away], ['home', home]];
  const sidesTie: [string, string][] = [['away', away], ['tie', 'Tie'], ['home', home]];

  const compact = compactAnswers(a as Record<string, unknown>);
  const problems = answerProblemDetails(compact as Record<string, unknown>);
  const validAnswers = problems.length > 0 ? savableAnswers(compact) : compact;
  const count = answeredCount(validAnswers);

  const errorByQuestion = new Map<QuestionKey, string>();
  for (const p of problems) {
    if (p.question && !errorByQuestion.has(p.question)) errorByQuestion.set(p.question, p.inline);
  }

  const invalidQuestions = QUESTION_ORDER.filter((q) => errorByQuestion.has(q));
  const unansweredQuestions = QUESTION_ORDER.filter((q) => !errorByQuestion.has(q) && !isQuestionAnswered(validAnswers, q));

  const showJump = invalidQuestions.length > 0 || (count > 0 && count < QUESTION_COUNT);
  const jumpKind = invalidQuestions.length > 0 ? 'error' : 'unanswered';

  function jumpToNext() {
    const pool = invalidQuestions.length > 0 ? invalidQuestions : unansweredQuestions;
    if (pool.length === 0) return;
    const currentIdx = lastJumped.current ? pool.indexOf(lastJumped.current) : -1;
    const target = pool[(currentIdx + 1) % pool.length];
    lastJumped.current = target;
    const el = questionRefs.current[target];
    if (!el) return;
    const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
    const control = el.querySelector<HTMLElement>('input, select, button:not([disabled])');
    control?.focus({ preventScroll: true });
    clearTimeout(flashTimer.current);
    setFlashed(target);
    flashTimer.current = setTimeout(() => setFlashed(null), 900);
  }

  const registerRef = (key: QuestionKey) => (el: HTMLFieldSetElement | null) => {
    questionRefs.current[key] = el;
  };

  function questionState(key: QuestionKey): 'invalid' | 'answered' | 'unanswered' {
    if (errorByQuestion.has(key)) return 'invalid';
    return isQuestionAnswered(validAnswers, key) ? 'answered' : 'unanswered';
  }

  const questionNodes: Record<QuestionKey, ReactNode> = {
    final: (
      <Question
        key="final"
        qKey="final"
        n={1}
        title="Final score"
        points="3 points (closest pick wins) · +1 point for the right winner · +1 point if within 15"
        help={vegasText(game)}
        error={errorByQuestion.get('final')}
        state={questionState('final')}
        flashed={flashed === 'final'}
        fieldsetRef={registerRef('final')}
      >
        <div className="tg-score">
          {sides.map(([side, abbr]) => {
            const key = side === 'away' ? 'finalAway' : 'finalHome';
            return (
              <label key={side} className="tg-score-team">
                <span>{abbr}</span>
                <NumberInput
                  value={a[key]}
                  max={FINAL_SCORE_MAX}
                  label={`${abbr} final score`}
                  invalid={errorByQuestion.has('final')}
                  describedBy={errorByQuestion.has('final') ? 'tg-err-final' : undefined}
                  onChange={(v) => update(key, v)}
                />
              </label>
            );
          })}
        </div>
      </Question>
    ),
    firstTeam: (
      <Question
        key="firstTeam"
        qKey="firstTeam"
        n={2}
        title="Which team scores first?"
        points="1 point"
        error={errorByQuestion.get('firstTeam')}
        state={questionState('firstTeam')}
        flashed={flashed === 'firstTeam'}
        fieldsetRef={registerRef('firstTeam')}
      >
        <Choice options={sides} value={a.firstTeam} onChange={(v) => update('firstTeam', v as Side | undefined)} />
      </Question>
    ),
    firstScoreType: (
      <Question
        key="firstScoreType"
        qKey="firstScoreType"
        n={3}
        title="How is the first score made?"
        points="1 point · 5 points for a safety"
        error={errorByQuestion.get('firstScoreType')}
        state={questionState('firstScoreType')}
        flashed={flashed === 'firstScoreType'}
        fieldsetRef={registerRef('firstScoreType')}
      >
        <Choice
          options={[['td', 'TD'], ['fg', 'FG'], ['safety', 'Safety']]}
          value={a.firstScoreType}
          onChange={(v) => update('firstScoreType', v as Answers['firstScoreType'])}
        />
      </Question>
    ),
    firstTdScorer: (
      <Question
        key="firstTdScorer"
        qKey="firstTdScorer"
        n={4}
        title="First TD scorer"
        points="3 points"
        error={errorByQuestion.get('firstTdScorer')}
        state={questionState('firstTdScorer')}
        flashed={flashed === 'firstTdScorer'}
        fieldsetRef={registerRef('firstTdScorer')}
      >
        <ScorerSelect
          game={game}
          value={a.firstTdScorer}
          invalid={errorByQuestion.has('firstTdScorer')}
          describedBy={errorByQuestion.has('firstTdScorer') ? 'tg-err-firstTdScorer' : undefined}
          onChange={(v) => update('firstTdScorer', v)}
        />
      </Question>
    ),
    halftime: (
      <Question
        key="halftime"
        qKey="halftime"
        n={5}
        title="Who's leading at halftime?"
        points="1 point"
        error={errorByQuestion.get('halftime')}
        state={questionState('halftime')}
        flashed={flashed === 'halftime'}
        fieldsetRef={registerRef('halftime')}
      >
        <Choice options={sidesTie} value={a.halftime} onChange={(v) => update('halftime', v as Answers['halftime'])} />
      </Question>
    ),
    passTds: (
      <Question
        key="passTds"
        qKey="passTds"
        n={6}
        title="Which team has more passing TDs?"
        points="1 point"
        error={errorByQuestion.get('passTds')}
        state={questionState('passTds')}
        flashed={flashed === 'passTds'}
        fieldsetRef={registerRef('passTds')}
      >
        <Choice options={sidesTie} value={a.passTds} onChange={(v) => update('passTds', v as Answers['passTds'])} />
      </Question>
    ),
    rushTds: (
      <Question
        key="rushTds"
        qKey="rushTds"
        n={7}
        title="Which team has more rushing TDs?"
        points="1 point"
        error={errorByQuestion.get('rushTds')}
        state={questionState('rushTds')}
        flashed={flashed === 'rushTds'}
        fieldsetRef={registerRef('rushTds')}
      >
        <Choice options={sidesTie} value={a.rushTds} onChange={(v) => update('rushTds', v as Answers['rushTds'])} />
      </Question>
    ),
    missedKick: (
      <Question
        key="missedKick"
        qKey="missedKick"
        n={8}
        title="Missed extra point or field goal?"
        points="1 point"
        note="Any missed or blocked kick. A failed 2-point try doesn't count."
        error={errorByQuestion.get('missedKick')}
        state={questionState('missedKick')}
        flashed={flashed === 'missedKick'}
        fieldsetRef={registerRef('missedKick')}
      >
        <YesNo value={a.missedKick} onChange={(v) => update('missedKick', v)} />
      </Question>
    ),
    leadChange4q: (
      <Question
        key="leadChange4q"
        qKey="leadChange4q"
        n={9}
        title="Lead change in the 4th quarter?"
        points="1 point"
        note="Yes if a team goes ahead when it was tied or behind. Overtime doesn't count."
        error={errorByQuestion.get('leadChange4q')}
        state={questionState('leadChange4q')}
        flashed={flashed === 'leadChange4q'}
        fieldsetRef={registerRef('leadChange4q')}
      >
        <YesNo value={a.leadChange4q} onChange={(v) => update('leadChange4q', v)} />
      </Question>
    ),
    ...Object.fromEntries(
      NUMBER_QUESTIONS.map((q, i) => [
        q.key,
        <Question
          key={q.key}
          qKey={q.key}
          n={10 + i}
          title={q.label}
          points="3 points (closest pick wins)"
          note={q.hint}
          help={averageHint(q.key, game.averages.nfl)}
          error={errorByQuestion.get(q.key)}
          state={questionState(q.key)}
          flashed={flashed === q.key}
          fieldsetRef={registerRef(q.key)}
        >
          <NumberStepper
            value={a[q.key]}
            max={q.max}
            seed={stepperDefault(q.key, game.averages.nfl, q.max)}
            coarseStep={q.key === 'longestTd' ? 5 : undefined}
            label={q.label}
            invalid={errorByQuestion.has(q.key)}
            describedBy={errorByQuestion.has(q.key) ? `tg-err-${q.key}` : undefined}
            onChange={(v) => update(q.key, v)}
          />
        </Question>,
      ]),
    ) as Record<(typeof NUMBER_QUESTIONS)[number]['key'], ReactNode>,
  };

  return (
    <form className="tg-pick-form" onSubmit={(e) => e.preventDefault()} aria-label={`Your picks for ${away} @ ${home}`}>
      <div className="tg-save" data-testid="tg-save-status">
        <div className="tg-save-row" role="status">
          <span className="tg-save-count">{count} of {QUESTION_COUNT} answered</span>
          <span className={`tg-save-${status.kind}`}>{statusText(status)}</span>
        </div>
        {showJump && (
          <button
            type="button"
            className={jumpKind === 'error' ? 'tg-jump-btn tg-jump-btn-error' : 'tg-jump-btn'}
            data-testid="tg-jump-next"
            data-jump-kind={jumpKind}
            onClick={jumpToNext}
          >
            <span>{jumpKind === 'error' ? 'Fix error' : 'Next unanswered'}</span>
            <ArrowDownIcon size={14} />
          </button>
        )}
      </div>

      {QUESTION_SECTIONS.map((sec) => {
        const done = sec.questions.filter((q) => !errorByQuestion.has(q) && isQuestionAnswered(validAnswers, q)).length;
        const total = sec.questions.length;
        const complete = done === total;
        return (
          <section key={sec.id} className="tg-q-section" aria-labelledby={`tg-sec-${sec.id}`} data-testid={`tg-section-${sec.id}`}>
            <header className="tg-q-section-head">
              <h3 id={`tg-sec-${sec.id}`} className="tg-q-section-title">
                {sec.title}
              </h3>
              <span className={complete ? 'tg-q-section-count tg-q-section-done' : 'tg-q-section-count'}>
                {complete && <CheckIcon size={12} />}
                <span>{done}/{total}</span>
              </span>
            </header>
            <div className="tg-q-section-list">{sec.questions.map((q) => questionNodes[q])}</div>
          </section>
        );
      })}

      {count === QUESTION_COUNT && problems.length === 0 && (
        <PicksCompleteCard
          game={game}
          nextGame={nextGame}
          nextAnswered={nextAnswered}
          totalQuestions={QUESTION_COUNT}
          justCompleted={justCompleted}
          onSelectGame={onSelectGame}
        />
      )}
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

function friendly(problems: AnswerProblem[]): string {
  const first = problems[0];
  const extra = problems.length > 1 ? ` (+${problems.length - 1} more)` : '';
  if (first.message.includes('needs both')) return `Saved, except the final score: enter both teams’ scores.${extra}`;
  if (first.message.includes('tie')) return `Saved, except the final score: it can’t be a tie.${extra}`;
  const detail = first.inline.charAt(0).toLowerCase() + first.inline.slice(1);
  return `Saved, except ${first.label}: ${detail}${extra}`;
}

/** "Vegas projects GB 25.5 – LAR 22 (GB -3.5, O/U 47.5)", or nothing without a line. */
function vegasText(game: Game): ReactNode {
  const { line, projection } = game;
  if (!line || !projection) return null;
  return (
    <span className="tg-vegas">
      Vegas projects {game.away.abbr} {formatPoints(projection.away)} – {game.home.abbr} {formatPoints(projection.home)}{' '}
      <span className="muted">({line.details || 'Pick’em'}, O/U {formatPoints(line.overUnder)})</span>
    </span>
  );
}

function Question(props: {
  qKey: QuestionKey;
  n: number;
  title: string;
  points: string;
  note?: string;
  help?: ReactNode;
  error?: string;
  state: 'invalid' | 'answered' | 'unanswered';
  flashed?: boolean;
  fieldsetRef?: (el: HTMLFieldSetElement | null) => void;
  children: ReactNode;
}) {
  const classes = ['tg-q'];
  if (props.state === 'answered') classes.push('tg-q-answered');
  if (props.state === 'invalid') classes.push('tg-q-invalid');
  if (props.flashed) classes.push('tg-q-flash');
  return (
    <fieldset ref={props.fieldsetRef} className={classes.join(' ')} data-question={props.qKey}>
      <legend className="tg-q-legend">
        <span className="tg-q-n">{props.n}</span>
        <span className="tg-q-title">{props.title}</span>
      </legend>
      <p className="tg-q-pts">{props.points}</p>
      {props.note && <p className="muted tg-small">{props.note}</p>}
      {props.children}
      {props.error && (
        <p id={`tg-err-${props.qKey}`} className="tg-q-error" role="alert" data-testid={`tg-err-${props.qKey}`}>
          {props.error}
        </p>
      )}
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

function NumberInput(props: {
  value: number | undefined;
  max: number;
  label: string;
  invalid?: boolean;
  describedBy?: string;
  onChange: (v: number | undefined) => void;
}) {
  return (
    <input
      className="tg-number"
      type="number"
      inputMode="numeric"
      min={0}
      max={props.max}
      step={1}
      aria-label={props.label}
      aria-invalid={props.invalid || undefined}
      aria-describedby={props.describedBy}
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

function NumberStepper(props: {
  value: number | undefined;
  max: number;
  seed: number;
  coarseStep?: number;
  label: string;
  invalid?: boolean;
  describedBy?: string;
  onChange: (v: number | undefined) => void;
}) {
  const { value, max, seed, coarseStep, label, invalid, describedBy, onChange } = props;
  const atMin = value !== undefined && value <= 0;
  const atMax = value !== undefined && value >= max;

  function stepBy(delta: number) {
    if (value === undefined) {
      onChange(seed);
      return;
    }
    const base = Number.isFinite(value) ? Math.round(value) : seed;
    onChange(Math.max(0, Math.min(max, base + delta)));
  }

  return (
    <div className={coarseStep ? 'tg-stepper tg-stepper-wide' : 'tg-stepper'}>
      {coarseStep && (
        <button
          type="button"
          className="tg-stepper-btn tg-stepper-coarse"
          aria-label={`Decrease by ${coarseStep}`}
          disabled={atMin}
          onClick={() => stepBy(-coarseStep)}
        >
          −{coarseStep}
        </button>
      )}
      <button
        type="button"
        className="tg-stepper-btn"
        aria-label="Decrease by 1"
        disabled={atMin}
        onClick={() => stepBy(-1)}
      >
        −
      </button>
      <NumberInput
        value={value}
        max={max}
        label={label}
        invalid={invalid}
        describedBy={describedBy}
        onChange={onChange}
      />
      <button
        type="button"
        className="tg-stepper-btn"
        aria-label="Increase by 1"
        disabled={atMax}
        onClick={() => stepBy(1)}
      >
        +
      </button>
      {coarseStep && (
        <button
          type="button"
          className="tg-stepper-btn tg-stepper-coarse"
          aria-label={`Increase by ${coarseStep}`}
          disabled={atMax}
          onClick={() => stepBy(coarseStep)}
        >
          +{coarseStep}
        </button>
      )}
    </div>
  );
}

const POS_ORDER: ScorerPosition[] = ['QB', 'RB', 'WR', 'TE'];

function ScorerSelect(props: {
  game: Game;
  value: string | undefined;
  invalid?: boolean;
  describedBy?: string;
  onChange: (v: string | undefined) => void;
}) {
  const { game } = props;
  const listed = props.value === undefined || props.value === 'other' || props.value === 'none' || game.scorers.some((s) => s.id === props.value);
  return (
    <select
      className="tg-select"
      aria-label="First TD scorer"
      aria-invalid={props.invalid || undefined}
      aria-describedby={props.describedBy}
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
