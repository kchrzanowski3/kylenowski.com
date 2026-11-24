import { signOut, type User } from 'firebase/auth';
import { collection, doc, limit, onSnapshot, orderBy, query, type Timestamp } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { adminCall, completeAdminLink, getAdminClients, sendAdminLink, watchUser, type Clients } from '../../../lib/thanksgiving/client';
import type { Overrides } from '../../../lib/thanksgiving/scoring';
import type { GameStats } from '../../../lib/thanksgiving/stats';
import { toGame, type Game, type Player } from '../../../lib/thanksgiving/view';
import { AdminGame } from './AdminGame';
import { AdminPlayers } from './AdminPlayers';

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export interface AdminData {
  games: Game[];
  players: Player[];
  live: Record<string, { feed: GameStats; feedAt: number }>;
  overrides: Record<string, { stats?: Overrides; paused?: boolean }>;
  published: Record<string, GameStats>;
  scorersFeed: Record<string, Game['scorers']>;
  scorerEdits: Record<string, { added: Game['scorers']; removed: string[] }>;
}

interface LogEntry {
  id: string;
  at: number;
  action: string;
  details: Record<string, unknown>;
}

const ms = (t: unknown) => ((t as Timestamp | undefined)?.toMillis?.() ?? null);

export default function AdminApp() {
  const [clients, setClients] = useState<Clients | null>(null);
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [notAdmin, setNotAdmin] = useState(false);
  const [data, setData] = useState<AdminData>({ games: [], players: [], live: {}, overrides: {}, published: {}, scorersFeed: {}, scorerEdits: {} });
  const [meta, setMeta] = useState<{ lastPollAt: number | null; refreshAt: number | null; delay: number; errors: string[] }>({ lastPollAt: null, refreshAt: null, delay: 0, errors: [] });
  const [log, setLog] = useState<LogEntry[]>([]);
  const now = useNow();

  useEffect(() => {
    void (async () => {
      try {
        const c = await getAdminClients();
        await completeAdminLink(c.auth, () => window.prompt('Confirm your email address to finish signing in'));
        setClients(c);
      } catch (e) {
        setError(`Sign-in failed: ${e instanceof Error ? e.message : String(e)}`);
        setClients(await getAdminClients());
      }
    })();
  }, []);

  useEffect(() => (clients ? watchUser(clients.auth, setUser) : undefined), [clients]);

  useEffect(() => {
    if (!clients || !user) return;
    const { db } = clients;
    const denied = (e: { code?: string }) => {
      if (e.code === 'permission-denied') setNotAdmin(true);
      else setError(String(e));
    };
    const merge = (patch: Partial<AdminData>) => setData((d) => ({ ...d, ...patch }));
    const offs = [
      onSnapshot(query(collection(db, 'tgGames'), orderBy('order')), (s) => merge({
        games: s.docs.map((d) => toGame(d.id, d.data())).filter((g): g is Game => g !== null),
        scorersFeed: Object.fromEntries(s.docs.map((d) => [d.id, d.get('scorersFeed') ?? d.get('scorers') ?? []])),
        scorerEdits: Object.fromEntries(s.docs.map((d) => [d.id, d.get('scorerEdits') ?? { added: [], removed: [] }])),
      })),
      onSnapshot(query(collection(db, 'tgPlayers'), orderBy('name')), (s) => merge({ players: s.docs.map((d) => ({ id: d.id, name: d.get('name'), hasPin: !!d.get('hasPin') })) })),
      onSnapshot(collection(db, 'tgLive'), (s) => { setNotAdmin(false); merge({ live: Object.fromEntries(s.docs.map((d) => [d.id, { feed: d.get('feed'), feedAt: d.get('feedAt') }])) }); }, denied),
      onSnapshot(collection(db, 'tgOverrides'), (s) => merge({ overrides: Object.fromEntries(s.docs.map((d) => [d.id, d.data()])) }), denied),
      onSnapshot(collection(db, 'tgResults'), (s) => merge({ published: Object.fromEntries(s.docs.map((d) => [d.id, d.get('stats')])) })),
      onSnapshot(doc(db, 'tgMeta/worker'), (s) => setMeta((m) => ({ ...m, lastPollAt: ms(s.get('lastPollAt')), errors: s.get('lastErrors') ?? [] }))),
      onSnapshot(doc(db, 'tgMeta/refresh'), (s) => setMeta((m) => ({ ...m, refreshAt: ms(s.get('lastRunAt')) }))),
      onSnapshot(doc(db, 'tgMeta/config'), (s) => setMeta((m) => ({ ...m, delay: Number(s.get('spoilerDelaySec') ?? 0) }))),
      onSnapshot(query(collection(db, 'tgAdminLog'), orderBy('at', 'desc'), limit(30)), (s) =>
        setLog(s.docs.map((d) => ({ id: d.id, at: ms(d.get('at')) ?? 0, action: d.get('action'), details: d.get('details') ?? {} }))), denied),
    ];
    return () => offs.forEach((off) => off());
  }, [clients, user]);

  if (!clients || user === undefined) return <p className="muted">Loading…</p>;
  if (!user) return <AdminSignIn clients={clients} error={error} />;

  const call = (body: Record<string, unknown>) => adminCall(clients.auth, body);
  const ago = (t: number | null) => (t === null ? 'never' : `${Math.max(0, Math.round((now - t) / 1000))} seconds ago`);

  return (
    <div className="tg tg-admin">
      <p>
        Signed in as <strong data-testid="tg-admin-email">{user.email}</strong>{' '}
        <button type="button" className="tg-link" onClick={() => void signOut(clients.auth)}>Sign out</button>
      </p>
      {notAdmin && <p className="tg-error" role="alert">This account isn't the admin.</p>}
      {error && <p className="tg-error" role="alert">{error}</p>}

      <section className="tg-card">
        <h2>Status</h2>
        <p data-testid="tg-last-update">Last live update: <strong>{ago(meta.lastPollAt)}</strong></p>
        <p className="muted tg-small">Pre-game refresh: {ago(meta.refreshAt)}</p>
        {meta.errors.length > 0 && <p className="tg-error tg-small">Worker errors: {meta.errors.join(' · ')}</p>}
        <SpoilerDelay value={meta.delay} onSave={(seconds) => call({ action: 'setSpoilerDelay', seconds })} />
        <ActionButton label="Re-run scoring" run={() => call({ action: 'rescore' })} />
      </section>

      {data.games.map((g) => (
        <AdminGame key={g.id} game={g} data={data} now={now} call={call} />
      ))}

      <AdminPlayers players={data.players} call={call} />

      <section className="tg-card">
        <h2>Change log</h2>
        {log.length === 0 ? <p className="muted">No changes yet.</p> : (
          <ul className="tg-log" data-testid="tg-admin-log">
            {log.map((e) => (
              <li key={e.id}>
                <span className="muted">{new Date(e.at).toLocaleString('en-US', { timeZone: 'America/New_York' })}</span> {e.action}{' '}
                <code>{JSON.stringify(e.details)}</code>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function AdminSignIn({ clients, error }: { clients: Clients; error: string | null }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<string | null>(error);
  return (
    <section className="tg-card">
      <h2>Admin sign-in</h2>
      {sent ? (
        <p role="status">Check your email for a sign-in link, and open it on this device.</p>
      ) : (
        <form
          className="tg-form"
          onSubmit={(e) => {
            e.preventDefault();
            sendAdminLink(clients.auth, email.trim()).then(() => setSent(true), (err: unknown) => setProblem(String(err)));
          }}
        >
          <label htmlFor="tg-admin-email-input">Email</label>
          <input id="tg-admin-email-input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <button type="submit" className="tg-primary">Email me a sign-in link</button>
        </form>
      )}
      {problem && <p className="tg-error" role="alert">{problem}</p>}
    </section>
  );
}

function SpoilerDelay({ value, onSave }: { value: number; onSave: (s: number) => Promise<unknown> }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <div className="tg-form tg-inline">
      <label htmlFor="tg-delay">Spoiler delay (seconds, 0–180)</label>
      <input id="tg-delay" type="number" min={0} max={180} step={1} value={draft} onChange={(e) => setDraft(e.target.value)} className="tg-number" />
      <ActionButton label="Save delay" run={() => onSave(Number(draft))} />
      <span className="muted tg-small">Players see live updates this many seconds late. This screen always shows them right away.</span>
    </div>
  );
}

export function ActionButton({ label, run, danger }: { label: string; run: () => Promise<unknown>; danger?: boolean }) {
  const [state, setState] = useState<{ busy: boolean; msg: string | null; ok: boolean }>({ busy: false, msg: null, ok: true });
  return (
    <span className="tg-action">
      <button
        type="button"
        className={danger ? 'tg-danger' : 'tg-primary'}
        disabled={state.busy}
        onClick={() => {
          setState({ busy: true, msg: null, ok: true });
          run().then(() => setState({ busy: false, msg: 'Done ✓', ok: true }), (e: unknown) => setState({ busy: false, msg: e instanceof Error ? e.message : String(e), ok: false }));
        }}
      >
        {label}
      </button>
      {state.msg && <span className={state.ok ? 'tg-ok tg-small' : 'tg-error tg-small'} role="status">{state.msg}</span>}
    </span>
  );
}
