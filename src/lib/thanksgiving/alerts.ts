// Pure snapshot-diffing alert engine for TV view and mobile in-app notifications.
// Comparing prev → next published results (after the admin spoiler delay) bundles every
// category change caused by a single play into one structured alert, and collapses game-end
// finalization into a single Game Final summary card.

import type { CategoryKey, CategoryResult, GameScore, Standings } from './scoring';
import type { GameStats, ScoreType } from './stats';
import { CATEGORY_SHORT, lockedPoints, rankStandings, type Game, type Player } from './view';

export interface ResultSnapshot {
  stats: GameStats;
  score: GameScore;
}

export type AlertKind = 'final' | 'banked' | 'scoring' | 'swing';

export interface AlertItem {
  categoryKey: CategoryKey;
  label: string;
  status: 'final' | 'live';
  points: number;
  /** All players currently earning points in this category. */
  winners: string[];
  /** Players who newly entered the lead / banked this category on this update. */
  gainedBy: string[];
  answer: string;
}

export interface StandingsChange {
  /** Player(s) currently in 1st place (or champions if final). */
  newLeaders: string[];
  /** Player(s) who newly moved into 1st place on this update. */
  gainedLeaders: string[];
  isChampion: boolean;
}

export interface CategoryFlash {
  key: CategoryKey;
  tone: 'final' | 'live';
}

export interface GameAlert {
  id: string;
  gameId: string;
  kind: AlertKind;
  tag: string;
  headline: string;
  subhead?: string;
  /** Categories that just became final (banked) on this play. Empty on Game Final (collapsed). */
  banked: AlertItem[];
  /** Live categories whose leaders changed on this play. */
  leading: AlertItem[];
  /** Populated when kind === 'final'. */
  gameWinners?: { playerIds: string[]; points: number };
  /** Populated when overall 1st place changed or overall champion(s) were crowned. */
  standingsLead?: StandingsChange;
  /** Whether the TV "Last Big Play" strip should display this alert. */
  showOnTvBanner: boolean;
  /** Table rows to briefly highlight in TV view. */
  flashedCategories: CategoryFlash[];
  at: number;
}

export interface MobileAlert {
  id: string;
  gameId: string;
  kind: AlertKind;
  tag: string;
  headline: string;
  impact: string;
  badge?: string;
  tone: 'banked' | 'live' | 'final';
  at: number;
}

const SCORE_TYPE_TAG: Record<ScoreType, string> = {
  td: 'TOUCHDOWN',
  fg: 'FIELD GOAL',
  safety: 'SAFETY',
};

const SCORE_TYPE_SHORT: Record<ScoreType, string> = {
  td: 'TD',
  fg: 'FG',
  safety: 'Safety',
};

function sameIdSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  return b.every((id) => setA.has(id));
}

function activeEarners(c: CategoryResult): string[] {
  return Object.entries(c.points)
    .filter(([, pts]) => pts > 0)
    .map(([id]) => id);
}

function categoryPointsValue(c: CategoryResult): number {
  const vals = Object.values(c.points).filter((n) => n > 0);
  if (vals.length > 0) return Math.max(...vals);
  const m = c.worth.match(/\d+/);
  return m ? Number.parseInt(m[0], 10) : 1;
}

function hasAnyRealPlay(s: GameStats): boolean {
  return (
    s.away > 0 ||
    s.home > 0 ||
    s.firstScore !== null ||
    s.firstTd !== null ||
    !!s.lastScoringPlay ||
    s.halftimeReached ||
    s.missedKick ||
    s.leadChange4q ||
    s.fgs > 0 ||
    s.punts > 0 ||
    s.tds > 0 ||
    s.turnovers > 0 ||
    s.sacks > 0
  );
}

function topStandingsLeaders(
  standings: Standings | null,
  results: Record<string, ResultSnapshot>,
  knownPlayerIds?: ReadonlySet<string>,
): string[] {
  if (!standings || standings.status === 'pre') return [];
  const rows = knownPlayerIds ? standings.rows.filter((r) => knownPlayerIds.has(r.playerId)) : standings.rows;
  if (rows.length === 0) return [];
  const locked = lockedPoints(results);
  const ranked = rankStandings(rows, locked, standings.status === 'final', 'live');
  if (ranked.length === 0) return [];
  // Don't crown a "leader" when everyone is still at 0 live points.
  if (ranked[0].live <= 0) return [];
  return ranked.filter((r) => r.rank === 1).map((r) => r.playerId);
}

export function detectStandingsChange(
  prevStandings: Standings | null,
  nextStandings: Standings | null,
  prevResults: Record<string, ResultSnapshot>,
  nextResults: Record<string, ResultSnapshot>,
  knownPlayerIds?: ReadonlySet<string>,
): StandingsChange | undefined {
  if (!nextStandings || nextStandings.status === 'pre') return undefined;
  if (nextStandings.status === 'final' && prevStandings?.status !== 'final' && nextStandings.champions.length > 0) {
    const champs = knownPlayerIds
      ? nextStandings.champions.filter((id) => knownPlayerIds.has(id))
      : nextStandings.champions;
    if (champs.length > 0) return { newLeaders: champs, gainedLeaders: champs, isChampion: true };
  }
  if (!prevStandings || prevStandings.status === 'pre') return undefined;
  const prevTop = topStandingsLeaders(prevStandings, prevResults, knownPlayerIds);
  const nextTop = topStandingsLeaders(nextStandings, nextResults, knownPlayerIds);
  if (nextTop.length === 0 || sameIdSet(prevTop, nextTop)) return undefined;
  const gained = nextTop.filter((id) => !prevTop.includes(id));
  // Fire if someone newly moved into 1st, OR if a tie at 1st broke into a solo leader.
  const brokeTieToSolo = nextTop.length === 1 && prevTop.length > 1 && prevTop.includes(nextTop[0]);
  if (gained.length === 0 && !brokeTieToSolo) return undefined;
  return {
    newLeaders: nextTop,
    gainedLeaders: gained.length > 0 ? gained : nextTop,
    isChampion: false,
  };
}

/** Returns playerIds whose live-pace standings rank improved (moved up) between snapshots. */
export function improvedRankIds(
  prevStandings: Standings | null,
  nextStandings: Standings | null,
  prevResults: Record<string, ResultSnapshot>,
  nextResults: Record<string, ResultSnapshot>,
  knownPlayerIds?: ReadonlySet<string>,
): string[] {
  if (!prevStandings || !nextStandings || prevStandings.status === 'pre' || nextStandings.status === 'pre') return [];
  const filterRows = (s: Standings) => (knownPlayerIds ? s.rows.filter((r) => knownPlayerIds.has(r.playerId)) : s.rows);
  const prevRanked = rankStandings(filterRows(prevStandings), lockedPoints(prevResults), prevStandings.status === 'final', 'live');
  const nextRanked = rankStandings(filterRows(nextStandings), lockedPoints(nextResults), nextStandings.status === 'final', 'live');
  const prevRankOf = new Map(prevRanked.map((r) => [r.playerId, r.rank]));
  return nextRanked
    .filter((r) => {
      const pr = prevRankOf.get(r.playerId);
      return pr !== undefined && r.rank < pr;
    })
    .map((r) => r.playerId);
}

function isNewScoringPlay(prev: GameStats, next: GameStats): boolean {
  const np = next.lastScoringPlay;
  if (!np) return false;
  const pp = prev.lastScoringPlay;
  if (!pp) return true;
  if (np.id && pp.id) return np.id !== pp.id;
  return np.text !== pp.text || np.side !== pp.side || np.type !== pp.type;
}

function formatClock(s: GameStats): string {
  if (s.state === 'post') return s.period > 4 ? 'Final/OT' : 'Final';
  if (s.halftimeReached && s.period <= 2) return 'Halftime';
  const q = s.period > 4 ? 'OT' : s.period > 0 ? `Q${s.period}` : '';
  return s.clock && q ? `${q} ${s.clock}` : q;
}

function describeTrigger(
  prev: GameStats,
  next: GameStats,
  game: Pick<Game, 'away' | 'home'>,
): { tag: string; headline: string; isScoringPlay: boolean; isTurnover: boolean } {
  const awayAbbr = game.away.abbr;
  const homeAbbr = game.home.abbr;
  const scoreText = `${awayAbbr} ${next.away} – ${homeAbbr} ${next.home}`;
  const scoreChanged = next.away !== prev.away || next.home !== prev.home;
  const newPlay = isNewScoringPlay(prev, next);
  const newFirstTd = !prev.firstTd && !!next.firstTd;

  if (newPlay && next.lastScoringPlay) {
    const play = next.lastScoringPlay;
    const teamAbbr = play.side === 'away' ? awayAbbr : homeAbbr;
    const tag = newFirstTd && play.type === 'td' ? 'FIRST TD' : SCORE_TYPE_TAG[play.type];
    const prefix = `${teamAbbr} ${SCORE_TYPE_SHORT[play.type]}`;
    const headline = play.text ? `${prefix} · ${play.text}` : `${prefix} · ${scoreText}`;
    return { tag, headline, isScoringPlay: true, isTurnover: next.turnovers > prev.turnovers };
  }

  if (scoreChanged) {
    const awayDelta = next.away - prev.away;
    const homeDelta = next.home - prev.home;
    const scoringSide = awayDelta > homeDelta ? 'away' : homeDelta > awayDelta ? 'home' : null;
    const teamAbbr = scoringSide === 'away' ? awayAbbr : scoringSide === 'home' ? homeAbbr : null;
    const tdAdded = next.tds > prev.tds;
    const fgAdded = next.fgs > prev.fgs;
    if (tdAdded || newFirstTd) {
      const tag = newFirstTd ? 'FIRST TD' : 'TOUCHDOWN';
      const passAdded = next.passTds.away > prev.passTds.away || next.passTds.home > prev.passTds.home;
      const rushAdded = next.rushTds.away > prev.rushTds.away || next.rushTds.home > prev.rushTds.home;
      const kind = passAdded ? 'passing TD' : rushAdded ? 'rushing TD' : 'TD';
      const scorer = newFirstTd && next.firstTd?.scorerName ? ` · ${next.firstTd.scorerName}` : '';
      const headline = teamAbbr ? `${teamAbbr} ${kind}${scorer}` : `Touchdown${scorer} · ${scoreText}`;
      return { tag, headline, isScoringPlay: true, isTurnover: next.turnovers > prev.turnovers };
    }
    if (fgAdded) {
      const headline = teamAbbr ? `${teamAbbr} field goal · ${scoreText}` : `Field goal · ${scoreText}`;
      return { tag: 'FIELD GOAL', headline, isScoringPlay: true, isTurnover: next.turnovers > prev.turnovers };
    }
    if (!prev.firstScore && next.firstScore?.type === 'safety') {
      const sAbbr = next.firstScore.side === 'away' ? awayAbbr : homeAbbr;
      return { tag: 'SAFETY', headline: `${sAbbr} safety · ${scoreText}`, isScoringPlay: true, isTurnover: next.turnovers > prev.turnovers };
    }
    return { tag: 'SCORE', headline: `Score update · ${scoreText}`, isScoringPlay: true, isTurnover: next.turnovers > prev.turnovers };
  }

  if (!prev.halftimeReached && next.halftimeReached) {
    return {
      tag: 'HALFTIME',
      headline: `Halftime · ${awayAbbr} ${next.halftime.away} – ${homeAbbr} ${next.halftime.home}`,
      isScoringPlay: false,
      isTurnover: false,
    };
  }
  if (!prev.leadChange4q && next.leadChange4q) {
    return { tag: '4Q LEAD CHANGE', headline: `4th-quarter lead change · ${scoreText}`, isScoringPlay: false, isTurnover: false };
  }
  if (!prev.missedKick && next.missedKick) {
    return { tag: 'MISSED KICK', headline: `Missed XP or FG · ${scoreText}`, isScoringPlay: false, isTurnover: false };
  }
  if (next.turnovers > prev.turnovers) {
    return { tag: 'TURNOVER', headline: `Turnover · ${next.turnovers} combined`, isScoringPlay: false, isTurnover: true };
  }
  if (next.sacks > prev.sacks) {
    return { tag: 'SACK', headline: `Sack · ${next.sacks} combined`, isScoringPlay: false, isTurnover: false };
  }
  if (next.punts > prev.punts) {
    return { tag: 'PUNT', headline: `Punt · ${next.punts} total`, isScoringPlay: false, isTurnover: false };
  }
  return { tag: 'LEAD CHANGE', headline: `Stat update · ${scoreText}`, isScoringPlay: false, isTurnover: false };
}

function sortItems(items: AlertItem[]): AlertItem[] {
  return [...items].sort((a, b) => b.points - a.points);
}

/**
 * Computes a single bundled GameAlert for one game's prev → next snapshot transition.
 * Returns null if nothing alert-worthy changed.
 */
export function diffGameAlert(opts: {
  game: Pick<Game, 'id' | 'away' | 'home'>;
  prev: ResultSnapshot | undefined;
  next: ResultSnapshot | undefined;
  standingsLead?: StandingsChange;
  at: number;
}): GameAlert | null {
  const { game, prev, next, standingsLead, at } = opts;
  if (!prev || !next) return null;
  if (next.score.status === 'pre' || next.stats.state === 'pre') return null;

  // Don't fire a noisy wave of "everyone tied at 0" alerts right when a game flips pre → in at 0–0.
  if (prev.stats.state === 'pre' && next.stats.state === 'in' && !hasAnyRealPlay(next.stats)) {
    return null;
  }

  const prevCats = new Map(prev.score.categories.map((c) => [c.key, c]));
  const scoreText = `${game.away.abbr} ${next.stats.away} – ${game.home.abbr} ${next.stats.home}`;

  // Game Final: collapse all remaining category finalizations into ONE Game Final summary card.
  if (prev.stats.state !== 'post' && next.stats.state === 'post') {
    const flashes: CategoryFlash[] = [];
    for (const c of next.score.categories) {
      const pc = prevCats.get(c.key);
      if (!pc || pc.status !== 'final') flashes.push({ key: c.key, tone: 'final' });
    }
    const winners = next.score.winners;
    const winPts = winners.length > 0 ? (next.score.totals[winners[0]] ?? 0) : 0;
    return {
      id: `${game.id}-final-${at}`,
      gameId: game.id,
      kind: 'final',
      tag: next.stats.period > 4 ? 'FINAL / OT' : 'FINAL',
      headline: scoreText,
      banked: [],
      leading: [],
      gameWinners: winners.length > 0 ? { playerIds: winners, points: winPts } : undefined,
      standingsLead,
      showOnTvBanner: true,
      flashedCategories: flashes,
      at,
    };
  }

  // Mid-game diff: bundle all newly-banked categories and live leader changes into one alert.
  const banked: AlertItem[] = [];
  const leading: AlertItem[] = [];
  const flashes: CategoryFlash[] = [];

  for (const c of next.score.categories) {
    const pc = prevCats.get(c.key);
    const nextIds = activeEarners(c);
    const prevIds = pc ? activeEarners(pc) : [];
    const newlyFinal = (!pc || pc.status !== 'final') && c.status === 'final';
    const leadersChanged = !sameIdSet(prevIds, nextIds);
    const gainedBy = nextIds.filter((id) => !prevIds.includes(id));

    if (newlyFinal) {
      flashes.push({ key: c.key, tone: 'final' });
      banked.push({
        categoryKey: c.key,
        label: CATEGORY_SHORT[c.key],
        status: 'final',
        points: categoryPointsValue(c),
        winners: nextIds,
        gainedBy: nextIds,
        answer: c.answer,
      });
    } else if (leadersChanged) {
      flashes.push({ key: c.key, tone: 'live' });
      if (nextIds.length > 0) {
        leading.push({
          categoryKey: c.key,
          label: CATEGORY_SHORT[c.key],
          status: 'live',
          points: categoryPointsValue(c),
          winners: nextIds,
          gainedBy,
          answer: c.answer,
        });
      }
    }
  }

  const trigger = describeTrigger(prev.stats, next.stats, game);
  const nothingChanged =
    !trigger.isScoringPlay &&
    !trigger.isTurnover &&
    banked.length === 0 &&
    leading.length === 0 &&
    flashes.length === 0 &&
    !standingsLead;
  if (nothingChanged) return null;

  const sortedBanked = sortItems(banked);
  const sortedLeading = sortItems(leading);
  const has3PtLeadChange = sortedLeading.some((item) => item.points >= 3);
  const showOnTvBanner =
    trigger.isScoringPlay ||
    sortedBanked.length > 0 ||
    !!standingsLead ||
    trigger.isTurnover ||
    has3PtLeadChange;

  const kind: AlertKind =
    sortedBanked.length > 0 ? 'banked' : trigger.isScoringPlay ? 'scoring' : 'swing';

  const clock = formatClock(next.stats);
  const subhead = trigger.headline.includes(scoreText) ? clock || undefined : [scoreText, clock].filter(Boolean).join(' · ');

  return {
    id: `${game.id}-${kind}-${at}`,
    gameId: game.id,
    kind,
    tag: trigger.tag,
    headline: trigger.headline,
    subhead,
    banked: sortedBanked,
    leading: sortedLeading,
    standingsLead,
    showOnTvBanner,
    flashedCategories: flashes,
    at,
  };
}

/**
 * Diffs the full set of game results + overall standings and returns alerts for every game
 * that changed on this snapshot.
 */
export function diffSnapshotAlerts(opts: {
  games: readonly Pick<Game, 'id' | 'away' | 'home'>[];
  prevResults: Record<string, ResultSnapshot>;
  nextResults: Record<string, ResultSnapshot>;
  prevStandings: Standings | null;
  nextStandings: Standings | null;
  players?: readonly Pick<Player, 'id'>[];
  at?: number;
}): GameAlert[] {
  const { games, prevResults, nextResults, prevStandings, nextStandings, players, at = Date.now() } = opts;
  const knownIds = players ? new Set(players.map((p) => p.id)) : undefined;
  const standingsLead = detectStandingsChange(prevStandings, nextStandings, prevResults, nextResults, knownIds);

  const alerts: GameAlert[] = [];
  let attachedStandings = false;
  for (const game of games) {
    const a = diffGameAlert({
      game,
      prev: prevResults[game.id],
      next: nextResults[game.id],
      standingsLead: attachedStandings ? undefined : standingsLead,
      at,
    });
    if (a) {
      if (a.standingsLead) attachedStandings = true;
      alerts.push(a);
    }
  }
  return alerts;
}

/** Formats a list of player ids compactly for TV pills: "Kyle", "Kyle & Sarah", "Kyle, Sarah + 2". */
export function formatAlertNames(ids: readonly string[], names: ReadonlyMap<string, string>, max = 2): string {
  const resolved = ids.map((id) => names.get(id)).filter((n): n is string => Boolean(n));
  if (resolved.length === 0) return 'No one';
  if (resolved.length === 1) return resolved[0];
  if (resolved.length === 2 && max >= 2) return `${resolved[0]} & ${resolved[1]}`;
  if (resolved.length <= max) return resolved.join(', ');
  return `${resolved.slice(0, max).join(', ')} + ${resolved.length - max}`;
}

function joinCategoryList(items: readonly AlertItem[], max = 2): string {
  const shown = items.slice(0, max).map((i) => `${i.label} (+${i.points})`);
  const extra = items.length - shown.length;
  if (extra > 0) return `${shown.join(', ')} + ${extra} more`;
  if (shown.length === 2) return `${shown[0]} & ${shown[1]}`;
  return shown[0] ?? '';
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * Turns a room-wide GameAlert into a personalized MobileAlert for `meId`.
 * Returns null if the play did not bank points, give a new lead, or end the game for `meId`.
 */
export function toMobileAlert(opts: {
  alert: GameAlert;
  meId: string | null;
  nextResult?: ResultSnapshot;
}): MobileAlert | null {
  const { alert, meId, nextResult } = opts;
  if (!meId) return null;

  if (alert.kind === 'final') {
    const totals = nextResult?.score.totals ?? {};
    const myPts = totals[meId] ?? 0;
    const winners = alert.gameWinners?.playerIds ?? nextResult?.score.winners ?? [];
    const wonGame = winners.includes(meId);
    const coWon = wonGame && winners.length > 1;
    const isChamp = !!alert.standingsLead?.isChampion && alert.standingsLead.newLeaders.includes(meId);
    const allScores = Object.values(totals);
    const betterCount = allScores.filter((pts) => pts > myPts).length;
    const rankStr = allScores.length > 1 ? ` (${ordinal(betterCount + 1)})` : '';

    const impact = isChamp
      ? `You’re the Thanksgiving Champion! (${myPts} pts this game)`
      : wonGame
        ? `You ${coWon ? 'co-won' : 'won'} the game with ${myPts} pts!`
        : `You banked ${myPts} pts${rankStr}`;

    return {
      id: alert.id,
      gameId: alert.gameId,
      kind: 'final',
      tag: alert.tag,
      headline: alert.headline,
      impact,
      badge: `${myPts} pts`,
      tone: 'final',
      at: alert.at,
    };
  }

  const myBanked = alert.banked.filter((i) => i.winners.includes(meId));
  const myLeading = alert.leading.filter((i) => i.gainedBy.includes(meId));
  const myOverallLead = !!alert.standingsLead && alert.standingsLead.gainedLeaders.includes(meId);

  if (myBanked.length === 0 && myLeading.length === 0 && !myOverallLead) return null;

  if (myBanked.length > 0) {
    const pts = myBanked.reduce((sum, i) => sum + i.points, 0);
    const liveNote =
      myLeading.length === 1
        ? ` · Now leading ${myLeading[0].label}`
        : myLeading.length > 1
          ? ` · Now leading ${myLeading.length} more`
          : '';
    return {
      id: alert.id,
      gameId: alert.gameId,
      kind: alert.kind,
      tag: alert.tag,
      headline: alert.headline,
      impact: `You banked ${joinCategoryList(myBanked)}${liveNote}`,
      badge: `+${pts} banked`,
      tone: 'banked',
      at: alert.at,
    };
  }

  if (myOverallLead) {
    const extra = myLeading.length > 0 ? ` · ${joinCategoryList(myLeading, 1)}` : '';
    return {
      id: alert.id,
      gameId: alert.gameId,
      kind: alert.kind,
      tag: alert.tag,
      headline: alert.headline,
      impact: `You moved into 1st overall!${extra}`,
      badge: '1st overall',
      tone: 'live',
      at: alert.at,
    };
  }

  const livePts = myLeading.reduce((sum, i) => sum + i.points, 0);
  return {
    id: alert.id,
    gameId: alert.gameId,
    kind: alert.kind,
    tag: alert.tag,
    headline: alert.headline,
    impact: `Now leading ${joinCategoryList(myLeading)}`,
    badge: `+${livePts} live`,
    tone: 'live',
    at: alert.at,
  };
}

export interface DemoAlertPair {
  label: string;
  tvAlert: GameAlert;
  mobileAlert: MobileAlert;
}

/**
 * Sample alerts for ?demoAlerts=1 so TV banners, row flashes, sound chimes, mobile toasts,
 * and the Recent updates strip can be previewed before kickoff.
 */
export function buildDemoAlerts(opts: {
  game: Pick<Game, 'id' | 'away' | 'home'> | null;
  players: readonly Pick<Player, 'id' | 'name'>[];
  meId: string | null;
  at?: number;
}): DemoAlertPair[] {
  const { game, players, meId, at = Date.now() } = opts;
  const gameId = game?.id ?? 'demo-game';
  const away = game?.away.abbr ?? 'CHI';
  const home = game?.home.abbr ?? 'DET';
  const p0 = meId ?? players[0]?.id ?? 'demo-1';
  const p1 = players.find((p) => p.id !== p0)?.id ?? p0;
  const p2 = players.find((p) => p.id !== p0 && p.id !== p1)?.id ?? p1;

  const firstTdTv: GameAlert = {
    id: `demo-first-td-${at}`,
    gameId,
    kind: 'banked',
    tag: 'FIRST TD',
    headline: `${home} TD · Jahmyr Gibbs 18 Yd Rush`,
    subhead: `${away} 0 – ${home} 7 · Q1 9:14`,
    banked: [
      { categoryKey: 'firstTdScorer', label: CATEGORY_SHORT.firstTdScorer, status: 'final', points: 3, winners: [p0, p1], gainedBy: [p0, p1], answer: 'Jahmyr Gibbs' },
      { categoryKey: 'firstTeam', label: CATEGORY_SHORT.firstTeam, status: 'final', points: 1, winners: [p0, p2], gainedBy: [p0, p2], answer: home },
      { categoryKey: 'firstScoreType', label: CATEGORY_SHORT.firstScoreType, status: 'final', points: 1, winners: [p0, p1, p2], gainedBy: [p0, p1, p2], answer: 'TD' },
    ],
    leading: [
      { categoryKey: 'finalClosest', label: CATEGORY_SHORT.finalClosest, status: 'live', points: 3, winners: [p1], gainedBy: [p1], answer: `${away} 0 – ${home} 7` },
      { categoryKey: 'tds', label: CATEGORY_SHORT.tds, status: 'live', points: 3, winners: [p0], gainedBy: [p0], answer: '1' },
    ],
    showOnTvBanner: true,
    flashedCategories: [
      { key: 'firstTdScorer', tone: 'final' },
      { key: 'firstTeam', tone: 'final' },
      { key: 'firstScoreType', tone: 'final' },
      { key: 'finalClosest', tone: 'live' },
      { key: 'tds', tone: 'live' },
    ],
    at,
  };

  const turnoverTv: GameAlert = {
    id: `demo-turnover-${at + 1}`,
    gameId,
    kind: 'swing',
    tag: 'TURNOVER',
    headline: 'Turnover · 3 combined',
    subhead: `${away} 10 – ${home} 14 · Q2 3:42`,
    banked: [],
    leading: [
      { categoryKey: 'turnovers', label: CATEGORY_SHORT.turnovers, status: 'live', points: 3, winners: [p0], gainedBy: [p0], answer: '3' },
    ],
    standingsLead: { newLeaders: [p0], gainedLeaders: [p0], isChampion: false },
    showOnTvBanner: true,
    flashedCategories: [{ key: 'turnovers', tone: 'live' }],
    at: at + 1,
  };

  const halftimeTv: GameAlert = {
    id: `demo-halftime-${at + 2}`,
    gameId,
    kind: 'banked',
    tag: 'HALFTIME',
    headline: `Halftime · ${away} 10 – ${home} 14`,
    banked: [
      { categoryKey: 'halftime', label: CATEGORY_SHORT.halftime, status: 'final', points: 1, winners: [p0, p2], gainedBy: [p0, p2], answer: home },
    ],
    leading: [],
    showOnTvBanner: true,
    flashedCategories: [{ key: 'halftime', tone: 'final' }],
    at: at + 2,
  };

  const finalTv: GameAlert = {
    id: `demo-final-${at + 3}`,
    gameId,
    kind: 'final',
    tag: 'FINAL',
    headline: `${away} 20 – ${home} 24`,
    banked: [],
    leading: [],
    gameWinners: { playerIds: [p0], points: 19 },
    standingsLead: { newLeaders: [p0], gainedLeaders: [p0], isChampion: false },
    showOnTvBanner: true,
    flashedCategories: [
      { key: 'finalClosest', tone: 'final' },
      { key: 'finalWinner', tone: 'final' },
      { key: 'finalWithin15', tone: 'final' },
      { key: 'tds', tone: 'final' },
      { key: 'fgs', tone: 'final' },
      { key: 'punts', tone: 'final' },
    ],
    at: at + 3,
  };

  const makeMobile = (tvAlert: GameAlert, fallback: MobileAlert): MobileAlert =>
    toMobileAlert({ alert: tvAlert, meId: p0 }) ?? fallback;

  return [
    {
      label: 'First TD',
      tvAlert: firstTdTv,
      mobileAlert: makeMobile(firstTdTv, {
        id: firstTdTv.id,
        gameId,
        kind: 'banked',
        tag: firstTdTv.tag,
        headline: firstTdTv.headline,
        impact: 'You banked First TD scorer (+3), First to score (+1) + 1 more',
        badge: '+5 banked',
        tone: 'banked',
        at,
      }),
    },
    {
      label: 'Big Swing',
      tvAlert: turnoverTv,
      mobileAlert: makeMobile(turnoverTv, {
        id: turnoverTv.id,
        gameId,
        kind: 'swing',
        tag: turnoverTv.tag,
        headline: turnoverTv.headline,
        impact: 'You moved into 1st overall! · Turnovers (+3)',
        badge: '1st overall',
        tone: 'live',
        at: at + 1,
      }),
    },
    {
      label: 'Halftime',
      tvAlert: halftimeTv,
      mobileAlert: makeMobile(halftimeTv, {
        id: halftimeTv.id,
        gameId,
        kind: 'banked',
        tag: halftimeTv.tag,
        headline: halftimeTv.headline,
        impact: 'You banked Halftime leader (+1)',
        badge: '+1 banked',
        tone: 'banked',
        at: at + 2,
      }),
    },
    {
      label: 'Game Final',
      tvAlert: finalTv,
      mobileAlert: {
        id: finalTv.id,
        gameId,
        kind: 'final',
        tag: finalTv.tag,
        headline: finalTv.headline,
        impact: 'You won the game with 19 pts!',
        badge: '19 pts',
        tone: 'final',
        at: at + 3,
      },
    },
  ];
}
