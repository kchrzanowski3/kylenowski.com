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
import { CONTEST_DATE } from '../../src/lib/thanksgiving/config';
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

async function loadGames(db: Firestore): Promise<GameRow[]> {
  const snap = await db.collection('tgGames').orderBy('order').get();
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
export async function pollFeed(db: Firestore, fetchJson: FetchJson, now: number, games: GameRow[]): Promise<string[]> {
  const started = games.filter((g) => g.kickoff <= now);
  if (started.length === 0) return [];
  const sb = await fetchJson(`${ESPN_SITE}/scoreboard?dates=${CONTEST_DATE}`);
  const comps = new Map<string, any>((sb?.events ?? []).map((e: any) => [String(e.id), e.competitions?.[0]]));
  const changed: string[] = [];

  for (const g of started) {
    const status = feedStatus(comps.get(g.id));
    if (status.state === 'pre') continue; // kicked off on paper, not yet in the feed
    const [liveSnap, overrideSnap] = await Promise.all([db.doc(`tgLive/${g.id}`).get(), db.doc(`tgOverrides/${g.id}`).get()]);
    if (overrideSnap.get('paused') === true) continue;
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

    if (prev && same(prev.feed, stats)) continue;
    const recent = [...(prev?.recent ?? []), { at: now, stats }].filter((s) => s.at >= now - HISTORY_MS);
    await db.doc(`tgLive/${g.id}`).set({ feed: stats, feedAt: now, recent, scorers } satisfies LiveDoc);
    changed.push(g.id);
  }
  return changed;
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
export async function publish(db: Firestore, now: number, gamesIn?: GameRow[]): Promise<PublishReport> {
  const games = gamesIn ?? (await loadGames(db));
  const delaySec = Number((await db.doc('tgMeta/config').get()).get('spoilerDelaySec') ?? 0);
  const delayMs = Math.max(0, Math.min(SPOILER_DELAY_MAX_SEC, delaySec)) * 1000;
  const players = (await db.collection('tgPlayers').get()).docs.map((d) => d.id);
  const playerSet = new Set(players);

  const scored: ScoredGame[] = [];
  const report: PublishReport = { results: [], standingsChanged: false };
  for (const g of games) {
    const [liveSnap, overrideSnap, resultSnap] = await Promise.all([
      db.doc(`tgLive/${g.id}`).get(),
      db.doc(`tgOverrides/${g.id}`).get(),
      db.doc(`tgResults/${g.id}`).get(),
    ]);
    const live = (liveSnap.exists ? liveSnap.data() : null) as LiveDoc | null;
    const overrides = (overrideSnap.get('stats') as Overrides | undefined) ?? null;
    const prevPublished = resultSnap.exists ? (resultSnap.get('stats') as GameStats) : null;
    const base = g.kickoff > now ? null : (delayedStats(live, now, delayMs) ?? prevPublished ?? null);
    const stats = applyOverrides(base ?? preGameStats(), g.kickoff > now ? null : overrides);

    const picks: PlayerPick[] =
      g.kickoff > now
        ? []
        : (await db.collection(`tgGames/${g.id}/picks`).get()).docs
            .filter((d) => playerSet.has(d.id))
            .map((d) => ({ playerId: d.id, answers: d.get('answers') ?? {} }));
    const score = scoreGame(stats, picks, { awayAbbr: g.away.abbr, homeAbbr: g.home.abbr, scorers: g.scorers });
    scored.push({ gameId: g.id, order: g.order, stats, score, picks });

    if (!resultSnap.exists || !same(resultSnap.get('stats'), stats) || !same(resultSnap.get('score'), score)) {
      await db.doc(`tgResults/${g.id}`).set({ stats, score, publishedAt: Timestamp.fromMillis(now) });
      report.results.push(g.id);
    }
  }

  const standings = overallStandings(players, scored);
  const prev = await db.doc('tgStandings/overall').get();
  if (!prev.exists || !same(prev.get('rows'), standings.rows) || prev.get('status') !== standings.status || !same(prev.get('champions'), standings.champions)) {
    await db.doc('tgStandings/overall').set({ ...standings, publishedAt: Timestamp.fromMillis(now) });
    report.standingsChanged = true;
  }
  return report;
}

/** Takes or renews the worker lease. False if another call holds it. */
export async function takeLease(db: Firestore, holder: string, now: number, forMs = 75_000): Promise<boolean> {
  const ref = db.doc('tgMeta/worker');
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
  opts: { holder: string; budgetMs?: number; clock?: () => number; sleep?: (ms: number) => Promise<void> },
): Promise<LiveRunReport> {
  const clock = opts.clock ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const start = clock();
  const budget = opts.budgetMs ?? 50_000;
  const report: LiveRunReport = { ran: false, polls: 0, errors: [] };
  if (!(await takeLease(db, opts.holder, start))) return report;
  report.ran = true;

  let games = await loadGames(db);
  if (games.some((g) => g.kickoff > start)) {
    try {
      await runPregameRefresh(db, fetchJson, clock, { seasonAverages: false });
      games = await loadGames(db);
    } catch (e) {
      report.errors.push(`pre-game refresh: ${String(e)}`);
    }
  }

  for (;;) {
    const t = clock();
    try {
      await pollFeed(db, fetchJson, t, games);
    } catch (e) {
      report.errors.push(`poll: ${String(e)}`);
    }
    try {
      await publish(db, t, games);
    } catch (e) {
      report.errors.push(`publish: ${String(e)}`);
    }
    report.polls++;
    await db.doc('tgMeta/worker').set(
      { lastPollAt: Timestamp.fromMillis(t), lastErrors: report.errors.slice(-5) },
      { merge: true },
    );
    const next = t + POLL_MS;
    if (next - start > budget) break;
    await sleep(Math.max(0, next - clock()));
    if (!(await takeLease(db, opts.holder, clock()))) break;
  }
  return report;
}
