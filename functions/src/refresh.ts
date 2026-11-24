// The pre-game refresh (docs/thanksgiving-spec.md, "Pre-game refresh"): the betting line and
// Vegas projection, kickoff/lock times, the first-TD-scorer lists and the reference averages.
// A game that has kicked off is frozen: nothing about it changes here any more.

import { Timestamp, type DocumentReference, type DocumentSnapshot, type Firestore } from 'firebase-admin/firestore';
import { seasonAverages } from '../../src/lib/thanksgiving/averages';
import { SEASON, col, contestAt, etDate, type Contest } from '../../src/lib/thanksgiving/config';
import { ESPN_CORE, ESPN_SITE, completedEventIds, deriveTeamGameStats, parseScoreboard, type FeedGame } from '../../src/lib/thanksgiving/espn';
import { nextKickoff } from '../../src/lib/thanksgiving/kickoff';
import { vegasProjection } from '../../src/lib/thanksgiving/projection';
import { applyScorerEdits, buildScorerOptions, parseRoster } from '../../src/lib/thanksgiving/scorers';
import type { ScorerEdits, ScorerOption, TeamAverages, TeamGameStats } from '../../src/lib/thanksgiving/types';
import { ensurePlayer } from './auth';
import { nameKey } from '../../src/lib/thanksgiving/players';
import { seedAnswers } from '../../src/lib/thanksgiving/seed-picks';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type FetchJson = (url: string) => Promise<any>;

export interface RefreshReport {
  games: { espnId: string; matchup: string; frozen: boolean }[];
  seasonGames: number;
  newSeasonGames: number;
  errors: string[];
  /** Practice only: the practice players this run created (Contest.seedPlayers). */
  seededPlayers?: string[];
  /** Practice only: how many practice-player picks this run created. */
  seededPicks?: number;
  /** Games removed because they're no longer on one of the contest's days (the practice games). */
  removedGames?: string[];
  /** Practice players removed, with their picks (Contest.retiredPlayers). */
  removedPlayers?: string[];
}

const REGULAR_SEASON_WEEKS = 18;

interface SeasonGameDoc {
  awayId: string;
  homeId: string;
  away: TeamGameStats;
  home: TeamGameStats;
}

/** Derived stats for every completed regular-season game before the contest, cached per game. */
async function loadSeasonGames(
  db: Firestore,
  fetchJson: FetchJson,
  errors: string[],
  contest: Contest,
): Promise<{ docs: SeasonGameDoc[]; fetched: number }> {
  const seasonGames = col(contest, 'SeasonGames');
  const firstDay = [...contest.daysEt].sort()[0];
  const cacheSnap = await db.collection(seasonGames).get();
  const cache = new Map(cacheSnap.docs.map((d) => [d.id, d.data() as SeasonGameDoc]));

  const ids: string[] = [];
  for (let week = 1; week <= REGULAR_SEASON_WEEKS; week++) {
    let sb: any;
    try {
      sb = await fetchJson(`${ESPN_SITE}/scoreboard?dates=${SEASON}&seasontype=2&week=${week}`);
    } catch (e) {
      errors.push(`week ${week} scoreboard: ${String(e)}`);
      continue;
    }
    const before = new Set(
      (sb?.events ?? []).filter((e: any) => etDate(Date.parse(e.date)) < firstDay).map((e: any) => String(e.id)),
    );
    ids.push(...completedEventIds(sb).filter((id) => before.has(id)));
  }

  const missing = ids.filter((id) => !cache.has(id));
  let fetched = 0;
  const queue = [...missing];
  const worker = async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      try {
        const derived = deriveTeamGameStats(await fetchJson(`${ESPN_SITE}/summary?event=${id}`));
        if (!derived) throw new Error('no teams in summary');
        const doc: SeasonGameDoc = derived;
        await db.collection(seasonGames).doc(id).set(doc);
        cache.set(id, doc);
        fetched++;
      } catch (e) {
        errors.push(`summary ${id}: ${String(e)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));

  return { docs: ids.map((id) => cache.get(id)).filter((d): d is SeasonGameDoc => !!d), fetched };
}

async function scorersFor(fetchJson: FetchJson, game: FeedGame): Promise<ScorerOption[]> {
  const out: ScorerOption[] = [];
  for (const side of ['away', 'home'] as const) {
    const team = game[side];
    const [chart, roster] = await Promise.all([
      fetchJson(`${ESPN_CORE}/seasons/${SEASON}/teams/${team.id}/depthcharts`),
      fetchJson(`${ESPN_SITE}/teams/${team.id}/roster`),
    ]);
    const list = buildScorerOptions(chart, parseRoster(roster), side);
    if (list.length === 0) throw new Error(`empty depth chart for ${team.abbr}`);
    out.push(...list);
  }
  return out;
}

export interface RefreshOptions {
  /**
   * Recompute the season averages (about 20 feed requests, more for games not cached yet). The live
   * worker, which refreshes every minute until each kickoff, skips this and keeps the stored ones.
   */
  seasonAverages?: boolean;
  /** Which contest to refresh; the one in effect at the clock's time unless given. */
  contest?: Contest;
}

/** Every game on the contest's scoreboards that falls on one of its days, ordered by kickoff. */
async function contestGames(fetchJson: FetchJson, contest: Contest): Promise<FeedGame[]> {
  const byId = new Map<string, FeedGame>();
  for (const date of contest.dates) {
    const sb = await fetchJson(`${ESPN_SITE}/scoreboard?dates=${date}`);
    for (const g of parseScoreboard(sb)) {
      if (contest.daysEt.includes(etDate(g.kickoff))) byId.set(g.espnId, g);
    }
  }
  return [...byId.values()].sort((x, y) => x.kickoff - y.kickoff || x.espnId.localeCompare(y.espnId));
}

export async function runPregameRefresh(
  db: Firestore,
  fetchJson: FetchJson,
  clock: () => number = Date.now,
  options: RefreshOptions = {},
): Promise<RefreshReport> {
  const withSeason = options.seasonAverages ?? true;
  const contest = options.contest ?? contestAt(clock());
  const errors: string[] = [];
  const report: RefreshReport = { games: [], seasonGames: 0, newSeasonGames: 0, errors };

  // The practice (docs/thanksgiving-spec.md, "Practice games"). Only the scheduled runs do this;
  // the live worker's per-minute refresh (withSeason false) leaves it to them.
  // Once the practice is over: remove the practice games and players first, so nothing below
  // sees them.
  if (withSeason) await endPractice(db, contest, report);
  // During the practice: Test1-Test10, without PINs, if missing. Done before the feed is read so
  // they exist even when it's down.
  if (withSeason && contest.seedPlayers.length > 0) {
    report.seededPlayers = [];
    for (const name of contest.seedPlayers) {
      if (await ensurePlayer(db, contest, name, clock())) report.seededPlayers.push(name);
    }
  }

  const games = await contestGames(fetchJson, contest);
  if (games.length === 0) throw new Error(`no games on the ${contest.dates.join(', ')} scoreboard`);

  const season = withSeason ? await loadSeasonGames(db, fetchJson, errors, contest) : { docs: [], fetched: 0 };
  report.seasonGames = season.docs.length;
  report.newSeasonGames = season.fetched;
  const teamGames = season.docs.flatMap((g) => [
    { teamId: g.awayId, stats: g.away },
    { teamId: g.homeId, stats: g.home },
  ]);
  const averages = seasonAverages(teamGames);

  for (const [i, game] of games.entries()) {
    const ref = db.collection(col(contest, 'Games')).doc(game.espnId);
    const matchup = `${game.away.abbr} @ ${game.home.abbr}`;

    let built: ScorerOption[] | null = null;
    try {
      built = await scorersFor(fetchJson, game);
    } catch (e) {
      errors.push(`${matchup} scorer list: ${String(e)}`); // keep the stored list
    }

    const frozen = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const existing = snap.exists ? snap.data()! : null;
      const now = clock();
      const stored = (existing?.kickoff as Timestamp | undefined)?.toMillis() ?? null;
      if (stored !== null && stored <= now) return true; // kicked off: line, list and lock are final

      const override = (existing?.kickoffOverride as Timestamp | null | undefined)?.toMillis() ?? null;
      const kickoff = nextKickoff({ stored, feed: game.kickoff, override, now })!;
      const edits = (existing?.scorerEdits as ScorerEdits | undefined) ?? null;
      const scorers = built ? applyScorerEdits(built, edits) : ((existing?.scorers as ScorerOption[] | undefined) ?? []);
      const avg = (id: string): TeamAverages | null => averages.byTeam[id] ?? null;

      tx.set(
        ref,
        {
          espnId: game.espnId,
          order: i + 1,
          away: game.away,
          home: game.home,
          tv: game.tv,
          kickoff: Timestamp.fromMillis(kickoff),
          kickoffFromFeed: Timestamp.fromMillis(game.kickoff),
          line: game.line,
          projection: game.line ? vegasProjection(game.line) : null,
          scorers,
          // The list as built from the feed, before admin edits, so an edit can be undone exactly.
          ...(built ? { scorersFeed: built } : {}),
          ...(withSeason ? { averages: { away: avg(game.away.id), home: avg(game.home.id), nfl: averages.nfl } } : {}),
          refreshedAt: Timestamp.fromMillis(now),
        },
        { merge: true }, // keeps admin fields (kickoffOverride, scorerEdits)
      );
      return false;
    });
    report.games.push({ espnId: game.espnId, matchup, frozen });
  }

  if (withSeason && contest.seedPlayers.length > 0) {
    try {
      report.seededPicks = await seedPicks(db, contest, clock());
    } catch (e) {
      errors.push(`seed picks: ${String(e)}`); // e.g. a player saved a pick at the same moment; next run retries
    }
  }

  await db.collection(col(contest, 'Meta')).doc('refresh').set(
    {
      lastRunAt: Timestamp.fromMillis(clock()),
      games: report.games.length,
      ...(withSeason ? { seasonGames: report.seasonGames } : {}),
      errors: errors.slice(0, 20),
    },
    { merge: true },
  );
  return report;
}

/**
 * Practice only: gives each practice player a full set of picks for every practice game they have
 * none for, including one that has already kicked off, so a practice game always has players to
 * score. Picks a person made (signed in as a practice player) are never replaced, and Thursday's
 * games never get seed picks. Returns how many it made.
 */
async function seedPicks(db: Firestore, contest: Contest, now: number): Promise<number> {
  const names = await db.getAll(...contest.seedPlayers.map((n) => db.collection(col(contest, 'Names')).doc(nameKey(n))));
  const players = names
    .map((snap, i) => ({ name: contest.seedPlayers[i], id: snap.get('playerId') as string | undefined }))
    .filter((p): p is { name: string; id: string } => typeof p.id === 'string');
  const games = await db.collection(col(contest, 'Games')).get();
  let made = 0;
  for (const g of games.docs.filter((d) => contest.seedPickDays.includes(storedDay(d)))) {
    const refs = players.map((p) => db.doc(`${col(contest, 'Games')}/${g.id}/picks/${p.id}`));
    const existing = refs.length > 0 ? await db.getAll(...refs) : [];
    const batch = db.batch();
    let n = 0;
    existing.forEach((snap, i) => {
      if (snap.exists) return;
      const answers = seedAnswers(players[i].name, g.id, (g.get('scorers') as ScorerOption[] | undefined) ?? []);
      batch.create(refs[i], { answers, updatedAt: Timestamp.fromMillis(now) });
      n++;
    });
    if (n > 0) await batch.commit();
    made += n;
  }
  return made;
}

/** The ET day a stored game is on, by the feed's kickoff (an admin's kickoff change doesn't move it). */
function storedDay(d: DocumentSnapshot): string {
  const t = (d.get('kickoffFromFeed') ?? d.get('kickoff')) as Timestamp | undefined;
  return t ? etDate(t.toMillis()) : '';
}

/** Deletes these docs, in batches. */
async function deleteAll(db: Firestore, refs: DocumentReference[]): Promise<void> {
  for (let i = 0; i < refs.length; i += 400) {
    const batch = db.batch();
    for (const ref of refs.slice(i, i + 400)) batch.delete(ref);
    await batch.commit();
  }
}

/**
 * The end of the practice (from 6:00 AM ET Thursday, see config.ts): removes every stored game that
 * isn't on one of the contest's days (the Mon/Wed practice games), with its picks, live values,
 * overrides and results; then removes the practice players (Contest.retiredPlayers) with their
 * picks. Real players, and their picks for Thursday's games, are kept. If anything was removed, the
 * standings are cleared; the live worker publishes fresh ones from Thursday's games.
 */
async function endPractice(db: Firestore, contest: Contest, report: RefreshReport): Promise<void> {
  const gamesCol = col(contest, 'Games');
  const games = await db.collection(gamesCol).get();
  // A game whose day can't be told is kept: only a game known to be on another day is removed.
  const stale = games.docs.filter((d) => storedDay(d) !== '' && !contest.daysEt.includes(storedDay(d)));
  for (const g of stale) {
    const picks = await db.collection(`${gamesCol}/${g.id}/picks`).listDocuments();
    await deleteAll(db, [
      ...picks,
      db.doc(`${col(contest, 'Live')}/${g.id}`),
      db.doc(`${col(contest, 'Overrides')}/${g.id}`),
      db.doc(`${col(contest, 'Results')}/${g.id}`),
      g.ref,
    ]);
  }
  if (stale.length > 0) report.removedGames = stale.map((g) => g.id);

  const removed: string[] = [];
  const kept = games.docs.filter((d) => !stale.includes(d));
  for (const name of contest.retiredPlayers) {
    const nameRef = db.collection(col(contest, 'Names')).doc(nameKey(name));
    const id = (await nameRef.get()).get('playerId') as string | undefined;
    if (!id) continue;
    await deleteAll(db, [
      ...kept.map((g) => db.doc(`${gamesCol}/${g.id}/picks/${id}`)),
      db.doc(`${col(contest, 'Secrets')}/${id}`),
      db.doc(`${col(contest, 'Players')}/${id}`),
      nameRef,
    ]);
    removed.push(name);
  }
  if (removed.length > 0) report.removedPlayers = removed;

  if (stale.length > 0 || removed.length > 0) await db.doc(`${col(contest, 'Standings')}/overall`).delete();
}
