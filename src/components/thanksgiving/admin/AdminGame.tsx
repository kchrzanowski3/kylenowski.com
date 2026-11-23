import { useState } from 'react';
import { etDateTime } from '../../../lib/thanksgiving/config';
import { isLocked } from '../../../lib/thanksgiving/kickoff';
import { OVERRIDABLE, type OverrideKey } from '../../../lib/thanksgiving/scoring';
import type { ScorerOption, ScorerPosition, Side } from '../../../lib/thanksgiving/types';
import type { Game } from '../../../lib/thanksgiving/view';
import { ActionButton, type AdminData } from './AdminApp';

type Call = (body: Record<string, unknown>) => Promise<unknown>;

const NUMBER_KEYS: OverrideKey[] = ['away', 'home', 'fgs', 'punts', 'tds', 'turnovers', 'longestTd', 'sacks'];
const BOOL_KEYS: OverrideKey[] = ['missedKick', 'leadChange4q', 'halftimeReached'];
const LABELS: Record<OverrideKey, string> = {
  state: 'Game state (pre / in / post)', away: 'Away score', home: 'Home score', firstScore: 'First score',
  firstTd: 'First TD', halftimeReached: 'Halftime reached', halftime: 'Halftime score', passTds: 'Passing TDs',
  rushTds: 'Rushing TDs', missedKick: 'Missed XP or FG', leadChange4q: '4th-quarter lead change', fgs: 'FGs made',
  punts: 'Punts', tds: 'Touchdowns', turnovers: 'Turnovers', longestTd: 'Longest TD (yards)', sacks: 'Sacks',
};
const EXAMPLES: Partial<Record<OverrideKey, string>> = {
  firstScore: '{"side":"home","type":"fg"}',
  firstTd: '{"side":"home","scorerId":"4429795","scorerName":"Jahmyr Gibbs"}',
  halftime: '{"away":10,"home":14}',
  passTds: '{"away":1,"home":2}',
  rushTds: '{"away":1,"home":0}',
};

const show = (v: unknown) => (v === undefined || v === null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** Parses what the admin typed for an override into the value tg-admin expects. */
export function parseOverride(key: OverrideKey, raw: string): unknown {
  const t = raw.trim();
  // An empty box would otherwise become 0 (Number('')) and silently zero a stat.
  if (t === '') throw new Error('Type a value first.');
  if (NUMBER_KEYS.includes(key)) return Number(t);
  if (BOOL_KEYS.includes(key)) return t === 'yes' || t === 'true';
  if (key === 'state') return t;
  return JSON.parse(t);
}

export function AdminGame({ game, data, now, call }: { game: Game; data: AdminData; now: number; call: Call }) {
  const locked = isLocked(game.kickoff, now);
  const live = data.live[game.id];
  const ov = data.overrides[game.id] ?? {};
  const published = data.published[game.id];

  return (
    <section className="tg-card" aria-labelledby={`tg-admin-${game.id}`} data-testid={`tg-admin-game-${game.id}`}>
      <h2 id={`tg-admin-${game.id}`}>
        Game {game.order}: {game.away.abbr} @ {game.home.abbr}
      </h2>
      <p className="muted">
        {etDateTime(game.kickoff)} · {locked ? 'Locked (picks revealed)' : 'Open for picks'}
        {live ? ` · feed updated ${Math.round((now - live.feedAt) / 1000)}s ago` : ' · no live data yet'}
      </p>

      <p>
        Feed: <strong>{ov.paused ? 'Paused' : 'Running'}</strong>{' '}
        <ActionButton label={ov.paused ? 'Resume feed' : 'Pause feed'} run={() => call({ action: 'setPaused', gameId: game.id, paused: !ov.paused })} />
      </p>

      {!locked && <KickoffEditor game={game} call={call} />}

      <div className="tg-reveal-wrap">
        <table className="tg-reveal tg-categories">
          <caption>Stats: the live feed, your override, and what players see (after the spoiler delay)</caption>
          <thead>
            <tr><th scope="col">Stat</th><th scope="col">Live feed</th><th scope="col">Override</th><th scope="col">Players see</th><th scope="col">Fix</th></tr>
          </thead>
          <tbody>
            {OVERRIDABLE.map((key) => (
              <tr key={key}>
                <th scope="row">{LABELS[key]}</th>
                <td>{show(live?.feed?.[key])}</td>
                <td><strong>{show(ov.stats?.[key])}</strong></td>
                <td>{show(published?.[key])}</td>
                <td><OverrideEditor gameId={game.id} k={key} current={ov.stats?.[key]} call={call} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!locked && <ScorerEditor game={game} feed={data.scorersFeed[game.id] ?? []} edits={data.scorerEdits[game.id] ?? { added: [], removed: [] }} call={call} />}
    </section>
  );
}

function OverrideEditor({ gameId, k, current, call }: { gameId: string; k: OverrideKey; current: unknown; call: Call }) {
  const [raw, setRaw] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const set = async () => {
    let value: unknown;
    try {
      value = parseOverride(k, raw);
    } catch {
      setProblem(`Not valid. Example: ${EXAMPLES[k] ?? ''}`);
      throw new Error('Not valid');
    }
    setProblem(null);
    await call({ action: 'setOverride', gameId, key: k, value });
    setRaw('');
  };
  const placeholder = BOOL_KEYS.includes(k) ? 'yes / no' : NUMBER_KEYS.includes(k) ? 'number' : k === 'state' ? 'pre / in / post' : EXAMPLES[k];
  return (
    <span className="tg-override">
      <input aria-label={`Override ${LABELS[k]}`} value={raw} placeholder={placeholder} onChange={(e) => setRaw(e.target.value)} className="tg-override-input" />
      <ActionButton label="Set" run={set} />
      {current !== undefined && <ActionButton label="Clear" run={() => call({ action: 'setOverride', gameId, key: k, value: null })} />}
      {problem && <span className="tg-error tg-small">{problem}</span>}
    </span>
  );
}

function KickoffEditor({ game, call }: { game: Game; call: Call }) {
  // datetime-local works in the browser's time zone.
  const toLocal = (t: number) => {
    const d = new Date(t);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const [value, setValue] = useState(toLocal(game.kickoff));
  return (
    <p className="tg-form tg-inline">
      <label htmlFor={`tg-kick-${game.id}`}>Kickoff / lock time (your time zone)</label>
      <input id={`tg-kick-${game.id}`} type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} />
      <ActionButton label="Save kickoff" run={() => call({ action: 'setKickoff', gameId: game.id, kickoffMs: new Date(value).getTime() })} />
    </p>
  );
}

function ScorerEditor({ game, feed, edits, call }: { game: Game; feed: ScorerOption[]; edits: { added: ScorerOption[]; removed: string[] }; call: Call }) {
  const [draft, setDraft] = useState({ id: '', name: '', pos: 'WR' as ScorerPosition, side: 'home' as Side });
  const save = (next: { added: ScorerOption[]; removed: string[] }) => call({ action: 'editScorers', gameId: game.id, edits: next });
  const all = [...feed, ...edits.added.filter((a) => !feed.some((f) => f.id === a.id))];
  return (
    <details className="tg-scorer-editor">
      <summary>First-TD-scorer list ({game.scorers.length} players)</summary>
      <ul>
        {all.map((p) => {
          const removed = edits.removed.includes(p.id);
          const added = edits.added.some((a) => a.id === p.id);
          return (
            <li key={`${p.side}-${p.id}`} className={removed ? 'muted' : undefined}>
              {p.name} ({p.pos}, {game[p.side].abbr}){added ? ' · added by you' : ''}{removed ? ' · removed' : ''}{' '}
              {added ? (
                <ActionButton label="Undo add" run={() => save({ ...edits, added: edits.added.filter((a) => a.id !== p.id) })} />
              ) : removed ? (
                <ActionButton label="Put back" run={() => save({ ...edits, removed: edits.removed.filter((id) => id !== p.id) })} />
              ) : (
                <ActionButton label="Remove" run={() => save({ ...edits, removed: [...edits.removed, p.id] })} />
              )}
            </li>
          );
        })}
      </ul>
      <div className="tg-form tg-inline">
        <input aria-label="ESPN athlete id" placeholder="ESPN athlete id" value={draft.id} onChange={(e) => setDraft({ ...draft, id: e.target.value.trim() })} />
        <input aria-label="Player name" placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <select aria-label="Position" value={draft.pos} onChange={(e) => setDraft({ ...draft, pos: e.target.value as ScorerPosition })}>
          {['QB', 'RB', 'WR', 'TE'].map((p) => <option key={p}>{p}</option>)}
        </select>
        <select aria-label="Team" value={draft.side} onChange={(e) => setDraft({ ...draft, side: e.target.value as Side })}>
          <option value="away">{game.away.abbr}</option>
          <option value="home">{game.home.abbr}</option>
        </select>
        <ActionButton label="Add player" run={() => save({ ...edits, added: [...edits.added, draft] })} />
      </div>
    </details>
  );
}
