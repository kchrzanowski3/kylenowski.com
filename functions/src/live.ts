// The live worker (docs/thanksgiving-spec.md, "Live updates"). Cloud Scheduler calls tg-live every
// minute from noon to midnight ET on Thursday; each call polls the feed about every 15 seconds for
// just under a minute. A lease in tgMeta/worker keeps calls from overlapping, and a call that dies
// is simply followed by the next minute's call, so no watchdog is needed.
//
//   ESPN ──poll──▶ tgLive/{game}     latest feed stats + recent history   (admin only, no delay)
//                  tgOverrides/{game} admin fixes and "pause the feed"     (admin only)
//          publish (after the spoiler delay, overrides applied):
//                  tgResults/{game}  stats + every category's points      (public)
//                  tgStandings/overall                                     (public)
//
// Writes happen only when something changed.

import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { col, contestAt, type Contest } from '../../src/lib/thanksgiving/config';
import { ESPN_CORE, ESPN_SITE } from '../../src/lib/thanksgiving/espn';
import { applyOverrides, overallStandings, scoreGame, type Overrides, type PlayerPick, type ScoredGame } from '../../src/lib/thanksgiving/scoring';
import { deriveGameStats, feedStatus, preGameStats, scorerIdFromCorePlay, type GameStats } from '../../src/lib/thanksgiving/stats';
import type { ScorerOption, TeamInfo } from '../../src/lib/thanksgiving/types';
import { runPregameRefresh, type FetchJson } from './refresh';

/* eslint-disable @typescript-eslint/no-explicit-any */

export const POLL_MS = 15_000;
export const SPOILER_DELAY_MAX_SEC = 180;
/** How much feed history tgLive keeps, enough for the longest spoiler delay. */
const HISTORY_MS = (SPOILER_DELAY_MAX_SEC + 60) * 1000;

interface Snapshot {
  at: number; // when the worker computed it (epoch ms)
  stats: GameStats;
}

interface LiveDoc {
  feed: GameStats;
  feedAt: number;
  recent: Snapshot[];
  /** ESPN play id → athlete id of its scorer, so each play is looked up once. */
  scorers: Record<string, string>;
}

interface GameRow {
  id: string;
  order: number;
  kickoff: number;
  away: TeamInfo;
  home: TeamInfo;
  scorers: ScorerOption[];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function loadGames(db: Firestore, contest: Contest): Promise<GameRow[]> {
  const snap = await db.collection(col(contest, 'Games')).orderBy('order').get();
  return snap.docs
    .filter((d) => d.get('kickoff'))
    .map((d) => ({
      id: d.id,
      order: d.get('order'),
      kickoff: (d.get('kickoff') as Timestamp).toMillis(),
      away: d.get('away'),
      home: d.get('home'),
      scorers: d.get('scorers') ?? [],
    }));
}

/**
 * Polls the feed once and stores what changed in tgLive. A paused game (tgOverrides.paused) keeps
 * its stored feed values. Returns the ids of games whose feed changed.
 */
export async function pollFeed(
  db: Firestore,
  fetchJson: FetchJson,
  now: number,
  games: GameRow[],
  errors: string[] = [],
  contest: Contest = contestAt(now),
): Promise<string[]> {
  const started = games.filter((g) => g.kickoff <= now);
  if (started.length === 0) return [];
  const comps = new Map<string, any>();
  for (const date of contest.dates) {
    const sb = await fetchJson(`${ESPN_SITE}/scoreboard?dates=${date}`);
    for (const e of sb?.events ?? []) comps.set(String(e.id), e.competitions?.[0]);
  }
  const changed: string[] = [];

  for (const g of started) {
    // One game's feed trouble mustn't stop the others from updating.
    try {
      if (await pollGame(db, fetchJson, now, g, comps.get(g.id), contest)) changed.push(g.id);
    } catch (e) {
      errors.push(`${g.away.abbr} @ ${g.home.abbr}: ${String(e)}`);
    }
  }
  return changed;
}

/** Polls one game; true if its stored feed changed. */
async function pollGame(db: Firestore, fetchJson: FetchJson, now: number, g: GameRow, competition: any, contest: Contest): Promise<boolean> {
  const live = col(contest, 'Live');
  {
    const status = feedStatus(competition);
    if (status.state === 'pre') return false; // kicked off on paper, not yet in the feed
    const [liveSnap, overrideSnap] = await Promise.all([db.doc(`${live}/${g.id}`).get(), db.doc(`${col(contest, 'Overrides')}/${g.id}`).get()]);
    if (overrideSnap.get('paused') === true) return false;
    const prev = (liveSnap.exists ? liveSnap.data() : null) as LiveDoc | null;

    const summary = await fetchJson(`${ESPN_SITE}/summary?event=${g.id}`);
    let stats = deriveGameStats(summary, status);
    const scorers = { ...(prev?.scorers ?? {}) };
    if (stats.firstTd) {
      const playId = stats.firstTd.playId;
      if (!scorers[playId]) {
        try {
          const play = await fetchJson(`${ESPN_CORE}/events/${g.id}/competitions/${g.id}/plays/${playId}`);
          const id = scorerIdFromCorePlay(play);
          if (id) scorers[playId] = id;
        } catch {
          // fall back to the name in the play text; try again next poll
        }
      }
      stats = { ...stats, firstTd: { ...stats.firstTd, scorerId: scorers[playId] ?? null } };
    }

    if (prev && same(prev.feed, stats)) return false;
    const recent = [...(prev?.recent ?? []), { at: now, stats }].filter((s) => s.at >= now - HISTORY_MS);
    await db.doc(`${live}/${g.id}`).set({ feed: stats, feedAt: now, recent, scorers } satisfies LiveDoc);
    return true;
  }
}

/** The feed stats players may see now: the newest snapshot at least `delayMs` old. */
export function delayedStats(live: LiveDoc | null, now: number, delayMs: number): GameStats | null {
  if (!live) return null;
  if (delayMs <= 0) return live.feed;
  const due = live.recent.filter((s) => s.at <= now - delayMs);
  return due.length > 0 ? due[due.length - 1].stats : null;
}

export interface PublishReport {
  results: string[]; // games whose public results changed
  standingsChanged: boolean;
}

/**
 * Scores every game from its delayed feed stats plus the admin's overrides and publishes what
 * changed: tgResults/{game} and tgStandings/overall. Also used for the one-off re-scoring after an
 * admin change, so it reads everything fresh.
 */
export async function publish(db: Firestore, now: number, gamesIn?: GameRow[], contest: Contest = contestAt(now)): Promise<PublishReport> {
  const c = (name: Parameters<typeof col>[1]) => col(contest, name);
  const games = gamesIn ?? (await loadGames(db, contest));
  const delaySec = Number((await db.doc(`${c('Meta')}/config`).get()).get('spoilerDelaySec') ?? 0);
  const delayMs = Math.max(0, Math.min(SPOILER_DELAY_MAX_SEC, delaySec)) * 1000;
  const players = (await db.collection(c('Players')).get()).docs.map((d) => d.id);
  const playerSet = new Set(players);

  const scored: ScoredGame[] = [];
  const report: PublishReport = { results: [], standingsChanged: false };
  for (const g of games) {
    const [liveSnap, overrideSnap, resultSnap] = await Promise.all([
      db.doc(`${c('Live')}/${g.id}`).get(),
      db.doc(`${c('Overrides')}/${g.id}`).get(),
      db.doc(`${c('Results')}/${g.id}`).get(),
    ]);
    const live = (liveSnap.exists ? liveSnap.data() : null) as LiveDoc | null;
    const overrides = (overrideSnap.get('stats') as Overrides | undefined) ?? null;
    const prevPublished = resultSnap.exists ? (resultSnap.get('stats') as GameStats) : null;
    const base = g.kickoff > now ? null : (delayedStats(live, now, delayMs) ?? prevPublished ?? null);
    // Missing fields (an older record, say) fall back to the pre-game defaults.
    const stats = applyOverrides({ ...preGameStats(), ...(base ?? {}) }, g.kickoff > now ? null : overrides);

    const picks: PlayerPick[] =
      g.kickoff > now
        ? []
        : (await db.collection(`${c('Games')}/${g.id}/picks`).get()).docs
            .filter((d) => playerSet.has(d.id))
            .map((d) => ({ playerId: d.id, answers: d.get('answers') ?? {} }));
    const score = scoreGame(stats, picks, { awayAbbr: g.away.abbr, homeAbbr: g.home.abbr, scorers: g.scorers });
    scored.push({ gameId: g.id, order: g.order, stats, score, picks });

    if (!resultSnap.exists || !same(resultSnap.get('stats'), stats) || !same(resultSnap.get('score'), score)) {
      await db.doc(`${c('Results')}/${g.id}`).set({ stats, score, publishedAt: Timestamp.fromMillis(now) });
      report.results.push(g.id);
    }
  }

  const standings = overallStandings(players, scored);
  const prev = await db.doc(`${c('Standings')}/overall`).get();
  if (!prev.exists || !same(prev.get('rows'), standings.rows) || prev.get('status') !== standings.status || !same(prev.get('champions'), standings.champions)) {
    await db.doc(`${c('Standings')}/overall`).set({ ...standings, publishedAt: Timestamp.fromMillis(now) });
    report.standingsChanged = true;
  }
  return report;
}

/** Ends this call's lease, so the next minute's call can start right away. */
export async function releaseLease(db: Firestore, holder: string, now: number, contest: Contest = contestAt(now)): Promise<void> {
  const ref = db.doc(`${col(contest, 'Meta')}/worker`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.get('leaseHolder') === holder) tx.set(ref, { leaseUntil: Timestamp.fromMillis(now) }, { merge: true });
  });
}

/** Takes or renews the worker lease. False if another call holds it. */
export async function takeLease(
  db: Firestore,
  holder: string,
  now: number,
  forMs = 75_000,
  contest: Contest = contestAt(now),
): Promise<boolean> {
  const ref = db.doc(`${col(contest, 'Meta')}/worker`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const until = (snap.get('leaseUntil') as Timestamp | undefined)?.toMillis() ?? 0;
    if (until > now && snap.get('leaseHolder') !== holder) return false;
    tx.set(ref, { leaseHolder: holder, leaseUntil: Timestamp.fromMillis(now + forMs) }, { merge: true });
    return true;
  });
}

export interface LiveRunReport {
  ran: boolean;
  polls: number;
  errors: string[];
}

/**
 * One scheduled call: polls every POLL_MS until `budgetMs` is used up. Before each game's kickoff
 * it also does the pre-game refresh (once per call), as the spec has the worker take that over
 * from noon.
 */
export async function runLive(
  db: Firestore,
  fetchJson: FetchJson,
  opts: { holder: string; budgetMs?: number; clock?: () => number; sleep?: (ms: number) => Promise<void>; contest?: Contest },
): Promise<LiveRunReport> {
  const clock = opts.clock ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const start = clock();
  const contest = opts.contest ?? contestAt(start);
  const budget = opts.budgetMs ?? 50_000;
  const report: LiveRunReport = { ran: false, polls: 0, errors: [] };
  if (!(await takeLease(db, opts.holder, start, undefined, contest))) return report;
  report.ran = true;

  let games = await loadGames(db, contest);
  if (games.some((g) => g.kickoff > start)) {
    try {
      await runPregameRefresh(db, fetchJson, clock, { seasonAverages: false, contest });
      games = await loadGames(db, contest);
    } catch (e) {
      report.errors.push(`pre-game refresh: ${String(e)}`);
    }
  }

  for (;;) {
    const t = clock();
    try {
      await pollFeed(db, fetchJson, t, games, report.errors, contest);
    } catch (e) {
      report.errors.push(`poll: ${String(e)}`);
    }
    try {
      await publish(db, t, games, contest);
    } catch (e) {
      report.errors.push(`publish: ${String(e)}`);
    }
    report.polls++;
    await db.doc(`${col(contest, 'Meta')}/worker`).set(
      { lastPollAt: Timestamp.fromMillis(t), lastErrors: report.errors.slice(-5) },
      { merge: true },
    );
    const next = t + POLL_MS;
    if (next - start > budget) break;
    await sleep(Math.max(0, next - clock()));
    if (!(await takeLease(db, opts.holder, clock(), undefined, contest))) break;
  }
  // Hand over to the next minute's call. Holding the lease past the end of this call would make
  // that call find it taken and skip a whole minute of updates.
  await releaseLease(db, opts.holder, clock(), contest);
  return report;
}
