// The pre-game refresh (docs/thanksgiving-spec.md, "Pre-game refresh"): the betting line and
// Vegas projection, kickoff/lock times, the first-TD-scorer lists and the reference averages.
// A game that has kicked off is frozen: nothing about it changes here any more.

import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { seasonAverages } from '../../src/lib/thanksgiving/averages';
import { CONTEST_DATE, CONTEST_DAY_ET, SEASON, etDate } from '../../src/lib/thanksgiving/config';
import { ESPN_CORE, ESPN_SITE, completedEventIds, deriveTeamGameStats, parseScoreboard, type FeedGame } from '../../src/lib/thanksgiving/espn';
import { nextKickoff } from '../../src/lib/thanksgiving/kickoff';
import { vegasProjection } from '../../src/lib/thanksgiving/projection';
import { applyScorerEdits, buildScorerOptions, parseRoster } from '../../src/lib/thanksgiving/scorers';
import type { ScorerEdits, ScorerOption, TeamAverages, TeamGameStats } from '../../src/lib/thanksgiving/types';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type FetchJson = (url: string) => Promise<any>;

export interface RefreshReport {
  games: { espnId: string; matchup: string; frozen: boolean }[];
  seasonGames: number;
  newSeasonGames: number;
  errors: string[];
}

const REGULAR_SEASON_WEEKS = 18;

interface SeasonGameDoc {
  awayId: string;
  homeId: string;
  away: TeamGameStats;
  home: TeamGameStats;
}

/** Derived stats for every completed regular-season game before the contest, cached per game. */
async function loadSeasonGames(db: Firestore, fetchJson: FetchJson, errors: string[]): Promise<{ docs: SeasonGameDoc[]; fetched: number }> {
  const cacheSnap = await db.collection('tgSeasonGames').get();
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
      (sb?.events ?? []).filter((e: any) => etDate(Date.parse(e.date)) < CONTEST_DAY_ET).map((e: any) => String(e.id)),
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
        await db.collection('tgSeasonGames').doc(id).set(doc);
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

export async function runPregameRefresh(db: Firestore, fetchJson: FetchJson, clock: () => number = Date.now): Promise<RefreshReport> {
  const errors: string[] = [];
  const report: RefreshReport = { games: [], seasonGames: 0, newSeasonGames: 0, errors };

  const sb = await fetchJson(`${ESPN_SITE}/scoreboard?dates=${CONTEST_DATE}`);
  const games = parseScoreboard(sb).filter((g) => etDate(g.kickoff) === CONTEST_DAY_ET);
  if (games.length === 0) throw new Error(`no games on the ${CONTEST_DATE} scoreboard`);

  const season = await loadSeasonGames(db, fetchJson, errors);
  report.seasonGames = season.docs.length;
  report.newSeasonGames = season.fetched;
  const teamGames = season.docs.flatMap((g) => [
    { teamId: g.awayId, stats: g.away },
    { teamId: g.homeId, stats: g.home },
  ]);
  const averages = seasonAverages(teamGames);

  for (const [i, game] of games.entries()) {
    const ref = db.collection('tgGames').doc(game.espnId);
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
          averages: { away: avg(game.away.id), home: avg(game.home.id), nfl: averages.nfl },
          refreshedAt: Timestamp.fromMillis(now),
        },
        { merge: true }, // keeps admin fields (kickoffOverride, scorerEdits)
      );
      return false;
    });
    report.games.push({ espnId: game.espnId, matchup, frozen });
  }

  await db.collection('tgMeta').doc('refresh').set({
    lastRunAt: Timestamp.fromMillis(clock()),
    games: report.games.length,
    seasonGames: report.seasonGames,
    errors: errors.slice(0, 20),
  });
  return report;
}
