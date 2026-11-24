// The pre-game refresh (docs/thanksgiving-spec.md, "Pre-game refresh"): the betting line and
// Vegas projection, kickoff/lock times, the first-TD-scorer lists and the reference averages.
// A game that has kicked off is frozen: nothing about it changes here any more.

import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { seasonAverages } from '../../src/lib/thanksgiving/averages';
import { REAL_CONTEST, SEASON, col, etDate, type Contest } from '../../src/lib/thanksgiving/config';
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
  /** Test contest only: the seed players this run created (see Contest.seedPlayers). */
  seededPlayers?: string[];
  /** Test contest only: how many seed-player picks this run created. */
  seededPicks?: number;
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
  /** Which contest to refresh; the real one unless given. */
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
  const contest = options.contest ?? REAL_CONTEST;
  const errors: string[] = [];
  const report: RefreshReport = { games: [], seasonGames: 0, newSeasonGames: 0, errors };

  // Test contest only (the real contest has no seed players): Test1-Test10, without PINs, if
  // missing. Done first so they exist even when the feed is down. The live worker's per-minute
  // refresh (withSeason false) leaves this to the scheduled runs.
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
 * Test contest only: gives each seed player a full set of picks for every game they have none for,
 * including a game that has already kicked off, so a practice game always has players to score.
 * Picks a person has made (signed in as a seed player) are never replaced. Returns how many it made.
 */
async function seedPicks(db: Firestore, contest: Contest, now: number): Promise<number> {
  if (contest.id === 'thanksgiving') throw new Error('the real contest has no seed players');
  const names = await db.getAll(...contest.seedPlayers.map((n) => db.collection(col(contest, 'Names')).doc(nameKey(n))));
  const players = names
    .map((snap, i) => ({ name: contest.seedPlayers[i], id: snap.get('playerId') as string | undefined }))
    .filter((p): p is { name: string; id: string } => typeof p.id === 'string');
  const games = await db.collection(col(contest, 'Games')).get();
  let made = 0;
  for (const g of games.docs) {
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
