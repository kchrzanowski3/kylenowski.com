// The live worker against the Firestore emulator and a fake ESPN (docs/thanksgiving-spec.md,
// "Live updates", "Live scoring", spoiler delay, admin overrides and pause).
import { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';
import { delayedStats, pollFeed, publish, runLive, takeLease } from '../../functions/src/live';
import type { FetchJson } from '../../functions/src/refresh';
import { load } from '../unit/fixtures';
import { clearFirestore, db } from './admin-app';

const T0 = Date.parse('2026-11-26T19:00:00Z'); // game 1 (kicked off 18:00) is on
const team = (id: string, abbr: string) => ({ id, abbr, name: abbr, shortName: abbr, color: null });

async function seed() {
  await clearFirestore();
  await db.doc('tgGames/g1').set({
    order: 1, kickoff: Timestamp.fromMillis(T0 - 3_600_000), away: team('18', 'NO'), home: team('3', 'CHI'),
    scorers: [{ id: '4259545', name: "D'Andre Swift", pos: 'RB', side: 'home' }],
  });
  await db.doc('tgGames/g2').set({ order: 2, kickoff: Timestamp.fromMillis(T0 + 3_600_000), away: team('21', 'PHI'), home: team('6', 'DAL'), scorers: [] });
  for (const id of ['ann', 'bob']) await db.doc(`tgPlayers/${id}`).set({ name: id, hasPin: false });
  await db.doc('tgGames/g1/picks/ann').set({ answers: { punts: 6, firstTdScorer: '4259545' } });
  await db.doc('tgGames/g1/picks/bob').set({ answers: { punts: 2, firstTdScorer: 'other' } });
}

/** A fake ESPN serving game 1 as in progress, with a summary we can swap. */
function fakeEspn() {
  const state = { summary: load('summary-no-at-chi-2026-wk11-safety.json'), calls: [] as string[] };
  const fetchJson: FetchJson = async (url) => {
    state.calls.push(url);
    if (url.includes('scoreboard?dates=20261126')) {
      return { events: [{ id: 'g1', competitions: [{ status: { period: 3, displayClock: '5:00', type: { state: 'in', name: 'STATUS_IN_PROGRESS' } } }] }] };
    }
    if (url.includes('summary?event=g1')) return state.summary;
    if (url.includes('/plays/')) return { participants: [{ type: 'scorer', athlete: { $ref: 'http://x/athletes/4259545?lang=en' } }] };
    throw new Error(`unexpected ${url}`);
  };
  return { state, fetchJson };
}

const live = async (id: string) => (await db.doc(`tgLive/${id}`).get()).data()!;
const result = async (id: string) => (await db.doc(`tgResults/${id}`).get()).data()!;
const standings = async () => (await db.doc('tgStandings/overall').get()).data()!;
const gameRows = async () => (await db.collection('tgGames').orderBy('order').get()).docs.map((d) => ({
  id: d.id, order: d.get('order'), kickoff: d.get('kickoff').toMillis(), away: d.get('away'), home: d.get('home'), scorers: d.get('scorers'),
}));

beforeEach(seed);

describe('polling the feed', () => {
  it('stores the live stats for games that have kicked off, and only writes when something changed', async () => {
    const espn = fakeEspn();
    expect(await pollFeed(db, espn.fetchJson, T0, await gameRows())).toEqual(['g1']);
    const first = await live('g1');
    expect(first.feed).toMatchObject({ state: 'in', period: 3, away: 13, home: 21, punts: 6 });
    expect(first.feedAt).toBe(T0);

    expect(await pollFeed(db, espn.fetchJson, T0 + 15_000, await gameRows())).toEqual([]); // nothing new
    expect((await live('g1')).feedAt).toBe(T0);
    expect(espn.state.calls.some((u) => u.includes('summary?event=g2'))).toBe(false); // game 2 hasn't started
  });

  it('looks up the first TD scorer id once, from the core-API play', async () => {
    const espn = fakeEspn();
    await pollFeed(db, espn.fetchJson, T0, await gameRows());
    expect((await live('g1')).feed.firstTd).toMatchObject({ scorerId: '4259545', scorerName: "D'Andre Swift" });
    espn.state.summary = load('summary-no-at-chi-2026-wk11-safety.json');
    espn.state.summary.boxscore.players[0].statistics.find((g: { name: string }) => g.name === 'punting').totals[0] = '4';
    await pollFeed(db, espn.fetchJson, T0 + 15_000, await gameRows());
    expect(espn.state.calls.filter((u) => u.includes('/plays/'))).toHaveLength(1);
    expect((await live('g1')).feed.punts).toBe(7);
  });

  it("keeps polling the other games when one game's feed fails", async () => {
    await db.doc('tgGames/g2').update({ kickoff: Timestamp.fromMillis(T0 - 60_000) });
    const errors: string[] = [];
    const fetchJson: FetchJson = async (url) => {
      if (url.includes('scoreboard?dates=20261126')) {
        const status = { period: 2, displayClock: '1:00', type: { state: 'in', name: 'STATUS_IN_PROGRESS' } };
        return { events: [{ id: 'g1', competitions: [{ status }] }, { id: 'g2', competitions: [{ status }] }] };
      }
      if (url.includes('summary?event=g1')) throw new Error('HTTP 503');
      if (url.includes('summary?event=g2')) return load('summary-mia-at-buf-2026-wk11.json');
      return { participants: [] };
    };
    expect(await pollFeed(db, fetchJson, T0, await gameRows(), errors)).toEqual(['g2']);
    expect(errors).toEqual(['NO @ CHI: Error: HTTP 503']);
  });

  it('skips a game the admin paused, keeping its stored values', async () => {
    const espn = fakeEspn();
    await pollFeed(db, espn.fetchJson, T0, await gameRows());
    await db.doc('tgOverrides/g1').set({ paused: true });
    espn.state.summary = load('summary-mia-at-buf-2026-wk11.json');
    expect(await pollFeed(db, espn.fetchJson, T0 + 15_000, await gameRows())).toEqual([]);
    expect((await live('g1')).feed.home).toBe(21);
  });
});

describe('publishing', () => {
  it('scores the game and the standings from the feed (no spoiler delay by default)', async () => {
    await pollFeed(db, fakeEspn().fetchJson, T0, await gameRows());
    await publish(db, T0);
    const r = await result('g1');
    expect(r.stats).toMatchObject({ away: 13, home: 21 });
    expect(r.score.status).toBe('live');
    // ann: punts exact (3) + Swift (3); bob: nothing.
    expect(r.score.totals).toEqual({ ann: 6 });
    const s = await standings();
    expect(s.rows.map((x: { playerId: string; total: number }) => [x.playerId, x.total])).toEqual([['ann', 6], ['bob', 0]]);
    expect(s.status).toBe('live');
    expect((await result('g2')).score.status).toBe('pre');
  });

  it('writes only when something changed', async () => {
    await pollFeed(db, fakeEspn().fetchJson, T0, await gameRows());
    expect((await publish(db, T0)).results.sort()).toEqual(['g1', 'g2']);
    expect(await publish(db, T0 + 15_000)).toEqual({ results: [], standingsChanged: false });
  });

  it('applies admin overrides over the feed; the admin still sees the feed value in tgLive', async () => {
    await pollFeed(db, fakeEspn().fetchJson, T0, await gameRows());
    await db.doc('tgOverrides/g1').set({ stats: { punts: 2 } });
    await publish(db, T0);
    expect((await result('g1')).stats.punts).toBe(2);
    expect((await result('g1')).score.totals).toEqual({ ann: 3, bob: 3 }); // bob's 2 is now exact
    expect((await live('g1')).feed.punts).toBe(6);
  });

  it("doesn't count picks of a removed player", async () => {
    await pollFeed(db, fakeEspn().fetchJson, T0, await gameRows());
    await db.doc('tgPlayers/ann').delete();
    await publish(db, T0);
    expect((await result('g1')).score.totals).toEqual({ bob: 3 }); // bob's 2 punts is now the closest
    expect((await standings()).rows.map((x: { playerId: string }) => x.playerId)).toEqual(['bob']);
  });
});

describe('spoiler delay', () => {
  it('players see each update only after the delay; changing it takes effect at once', async () => {
    const espn = fakeEspn();
    await db.doc('tgMeta/config').set({ spoilerDelaySec: 60 });
    await pollFeed(db, espn.fetchJson, T0, await gameRows()); // update A: CHI 21
    espn.state.summary = load('summary-mia-at-buf-2026-wk11.json');
    await pollFeed(db, espn.fetchJson, T0 + 30_000, await gameRows()); // update B: home 26

    await publish(db, T0 + 30_000);
    expect((await result('g1')).score.status).toBe('pre'); // nothing is 60 seconds old yet
    await publish(db, T0 + 60_000);
    expect((await result('g1')).stats.home).toBe(21); // A
    await publish(db, T0 + 75_000);
    expect((await result('g1')).stats.home).toBe(21); // B is only 45 seconds old
    await publish(db, T0 + 90_000);
    expect((await result('g1')).stats.home).toBe(26); // B

    // The admin view (tgLive) always has the newest values.
    expect((await live('g1')).feed.home).toBe(26);
  });

  it('turning the delay off publishes the newest values right away', async () => {
    const espn = fakeEspn();
    await db.doc('tgMeta/config').set({ spoilerDelaySec: 180 });
    await pollFeed(db, espn.fetchJson, T0, await gameRows());
    await publish(db, T0 + 10_000);
    expect((await result('g1')).score.status).toBe('pre');
    await db.doc('tgMeta/config').set({ spoilerDelaySec: 0 });
    await publish(db, T0 + 11_000);
    expect((await result('g1')).stats.home).toBe(21);
  });

  it('delayedStats picks the newest snapshot old enough', () => {
    const snap = (at: number, home: number) => ({ at, stats: { home } as never });
    const doc = { feed: { home: 3 } as never, feedAt: 30, recent: [snap(0, 1), snap(15, 2), snap(30, 3)], scorers: {} };
    expect(delayedStats(doc, 30, 0)).toEqual({ home: 3 });
    expect(delayedStats(doc, 30, 15)).toEqual({ home: 2 });
    expect(delayedStats(doc, 30, 31)).toBeNull();
    expect(delayedStats(null, 30, 0)).toBeNull();
  });
});

describe('scheduled calls', () => {
  it('poll about every 15 seconds within a call', async () => {
    // Both games on (so no pre-game refresh is due this call).
    await db.doc('tgGames/g2').update({ kickoff: Timestamp.fromMillis(T0 - 60_000) });
    let t = T0;
    const report = await runLive(db, fakeEspn().fetchJson, {
      holder: 'call-1', budgetMs: 50_000, clock: () => t, sleep: async (ms) => { t += ms; },
    });
    expect(report).toMatchObject({ ran: true, polls: 4, errors: [] });
    expect((await db.doc('tgMeta/worker').get()).get('lastPollAt').toMillis()).toBe(T0 + 45_000);
  });

  it('hand over: the next minute\'s call runs, so no minute is skipped', async () => {
    await db.doc('tgGames/g2').update({ kickoff: Timestamp.fromMillis(T0 - 60_000) });
    let t = T0;
    const opts = (holder: string) => ({ holder, budgetMs: 50_000, clock: () => t, sleep: async (ms: number) => { t += ms; } });
    expect((await runLive(db, fakeEspn().fetchJson, opts('minute-1'))).ran).toBe(true);
    t = T0 + 60_000; // Cloud Scheduler's next call
    expect(await runLive(db, fakeEspn().fetchJson, opts('minute-2'))).toMatchObject({ ran: true, polls: 4 });
  });

  it("don't overlap: a second call exits while the first holds the lease", async () => {
    expect(await takeLease(db, 'call-1', T0)).toBe(true);
    expect(await takeLease(db, 'call-2', T0 + 10_000)).toBe(false);
    const report = await runLive(db, fakeEspn().fetchJson, { holder: 'call-2', clock: () => T0 + 20_000, sleep: async () => {} });
    expect(report.polls).toBe(0);
    expect(report.ran).toBe(false);
    // Once the lease runs out (the first call died), the next call takes over.
    expect(await takeLease(db, 'call-3', T0 + 80_000)).toBe(true);
  });
});
