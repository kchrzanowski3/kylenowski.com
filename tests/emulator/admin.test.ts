// The admin service (docs/thanksgiving-spec.md, "Admin"), against the Firestore and Auth emulators.
import { deleteApp, initializeApp as initClient } from 'firebase/app';
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth as getClientAuth } from 'firebase/auth';
import { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';
import { adminAction, ensureAdminUser, overrideProblem, verifyAdmin } from '../../functions/src/admin';
import { AuthError, joinPlayer, loginPlayer } from '../../functions/src/auth';
import { preGameStats } from '../../src/lib/thanksgiving/stats';
import { PROJECT, auth, clearFirestore, db, signInOnNewDevice } from './admin-app';

const ADMIN = 'kyle-admin@example.com';
const NOW = Date.parse('2026-11-26T19:00:00Z');
const team = (id: string, abbr: string) => ({ id, abbr, name: abbr, shortName: abbr, color: null });

async function clearAuth() {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
}

async function tokenFor(email: string, emailVerified: boolean): Promise<string> {
  const user = await auth.createUser({ email, emailVerified });
  return (await signInOnNewDevice(await auth.createCustomToken(user.uid))).idToken;
}

async function expectError(p: Promise<unknown>, status: number, message?: RegExp) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(AuthError);
  expect((err as AuthError).status).toBe(status);
  if (message) expect((err as AuthError).message).toMatch(message);
}

beforeEach(async () => {
  await clearFirestore();
  await clearAuth();
  const scorers = [{ id: '101', name: 'Caleb Williams', pos: 'QB', side: 'away' }];
  await db.doc('tgGames/g1').set({ order: 1, kickoff: Timestamp.fromMillis(NOW - 3_600_000), away: team('3', 'CHI'), home: team('8', 'DET'), scorers, scorersFeed: scorers });
  await db.doc('tgGames/g2').set({ order: 2, kickoff: Timestamp.fromMillis(NOW + 3_600_000), away: team('21', 'PHI'), home: team('6', 'DAL'), scorers, scorersFeed: scorers });
});

const log = async () => (await db.collection('tgAdminLog').orderBy('at').get()).docs.map((d) => d.get('action'));
const act = (body: Record<string, unknown>) => adminAction(db, auth, ADMIN, body, NOW);

describe('who is the admin', () => {
  it('the configured address, verified by the emailed link', async () => {
    expect(await verifyAdmin(auth, await tokenFor(ADMIN, true), ADMIN)).toBe(ADMIN);
  });

  it('nobody else: another address, the admin address unverified, a player, or no sign-in', async () => {
    await expectError(verifyAdmin(auth, await tokenFor('eve@example.com', true), ADMIN), 403);
    await expectError(verifyAdmin(auth, await tokenFor(ADMIN, false), ADMIN), 403);
    const player = await joinPlayer(db, auth, { name: 'Sue' }, NOW);
    await expectError(verifyAdmin(auth, (await signInOnNewDevice(player.token)).idToken, ADMIN), 403);
    await expectError(verifyAdmin(auth, '', ADMIN), 401);
    await expectError(verifyAdmin(auth, 'garbage', ADMIN), 401);
  });

  it("refuses everyone when the admin address isn't configured", async () => {
    await expectError(verifyAdmin(auth, await tokenFor(ADMIN, true), ''), 500);
  });

  it('the admin account is created up front, so nobody can register the address with a password', async () => {
    await ensureAdminUser(auth, ADMIN);
    await ensureAdminUser(auth, ADMIN); // already there: no-op
    const user = await auth.getUserByEmail(ADMIN);
    expect(user.passwordHash).toBeUndefined();
    const client = initClient({ apiKey: 'demo-key', projectId: PROJECT }, 'attacker');
    const clientAuth = getClientAuth(client);
    connectAuthEmulator(clientAuth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099'}`, { disableWarnings: true });
    await expect(createUserWithEmailAndPassword(clientAuth, ADMIN, 'hunter22')).rejects.toThrow(/email-already-in-use/);
    await deleteApp(client);
  });
});

describe('admin actions', () => {
  it('fixes a stat: the override wins over the feed, re-scores at once, and is logged', async () => {
    await db.doc('tgPlayers/ann').set({ name: 'Ann', hasPin: false });
    await db.doc('tgGames/g1/picks/ann').set({ answers: { punts: 9 } });
    await db.doc('tgLive/g1').set({ feed: { ...preGameStats(), state: 'in', period: 2, punts: 4 }, feedAt: NOW, recent: [], scorers: {} });
    await act({ action: 'setOverride', gameId: 'g1', key: 'punts', value: 9 });
    expect((await db.doc('tgOverrides/g1').get()).get('stats')).toEqual({ punts: 9 });
    const result = (await db.doc('tgResults/g1').get()).data()!;
    expect(result.stats.punts).toBe(9);
    expect(result.score.totals.ann).toBe(3);
    // Clearing the override goes back to the feed.
    await act({ action: 'setOverride', gameId: 'g1', key: 'punts', value: null });
    expect((await db.doc('tgOverrides/g1').get()).get('stats')).toEqual({});
    expect(await log()).toEqual(['setOverride', 'setOverride']);
  });

  it('refuses unknown stats and bad values', async () => {
    await expectError(act({ action: 'setOverride', gameId: 'g1', key: 'kickoff', value: 1 }), 400);
    await expectError(act({ action: 'setOverride', gameId: 'g1', key: 'punts', value: -1 }), 400);
    await expectError(act({ action: 'setOverride', gameId: 'nope', key: 'punts', value: 1 }), 404);
    expect(overrideProblem('firstScore', { side: 'home', type: 'safety' })).toBeNull();
    expect(overrideProblem('firstScore', { side: 'up', type: 'safety' })).not.toBeNull();
    expect(overrideProblem('firstTd', { side: 'home', scorerId: '101', scorerName: 'Caleb Williams' })).toBeNull();
    expect(overrideProblem('halftime', { away: 7, home: 3 })).toBeNull();
    expect(overrideProblem('missedKick', 'yes')).not.toBeNull();
  });

  it('pauses and resumes the feed for a game', async () => {
    await act({ action: 'setPaused', gameId: 'g1', paused: true });
    expect((await db.doc('tgOverrides/g1').get()).get('paused')).toBe(true);
    await act({ action: 'setPaused', gameId: 'g1', paused: false });
    expect((await db.doc('tgOverrides/g1').get()).get('paused')).toBe(false);
  });

  it('sets the spoiler delay, 0–180 seconds', async () => {
    await act({ action: 'setSpoilerDelay', seconds: 90 });
    expect((await db.doc('tgMeta/config').get()).get('spoilerDelaySec')).toBe(90);
    await expectError(act({ action: 'setSpoilerDelay', seconds: 181 }), 400);
    await expectError(act({ action: 'setSpoilerDelay', seconds: 1.5 }), 400);
  });

  it('re-runs scoring', async () => {
    expect(await act({ action: 'rescore' })).toMatchObject({ ok: true });
    expect((await db.doc('tgStandings/overall').get()).exists).toBe(true);
  });

  it('renames a player, keeping names unique ignoring case', async () => {
    const sue = await joinPlayer(db, auth, { name: 'Sue' }, NOW);
    await joinPlayer(db, auth, { name: 'Bob' }, NOW);
    await act({ action: 'renamePlayer', playerId: sue.playerId, name: 'Aunt Sue' });
    expect((await db.doc(`tgPlayers/${sue.playerId}`).get()).get('name')).toBe('Aunt Sue');
    expect((await db.doc('tgNames/sue').get()).exists).toBe(false);
    expect((await db.doc('tgNames/aunt sue').get()).get('playerId')).toBe(sue.playerId);
    await expectError(act({ action: 'renamePlayer', playerId: sue.playerId, name: 'BOB' }), 409);
    await act({ action: 'renamePlayer', playerId: sue.playerId, name: 'AUNT SUE' }); // same name, new case
    expect((await db.doc(`tgPlayers/${sue.playerId}`).get()).get('name')).toBe('AUNT SUE');
  });

  it('resets a PIN, so the name signs in without one again', async () => {
    const bob = await joinPlayer(db, auth, { name: 'Bob', pin: '1234' }, NOW);
    await act({ action: 'resetPin', playerId: bob.playerId });
    expect((await db.doc(`tgPlayers/${bob.playerId}`).get()).get('hasPin')).toBe(false);
    await expect(loginPlayer(db, auth, { playerId: bob.playerId }, NOW)).resolves.toHaveProperty('token');
  });

  it('removes a player with their picks, frees the name, and re-scores', async () => {
    const sue = await joinPlayer(db, auth, { name: 'Sue' }, NOW);
    await db.doc(`tgGames/g1/picks/${sue.playerId}`).set({ answers: { punts: 1 } });
    await act({ action: 'removePlayer', playerId: sue.playerId });
    expect((await db.doc(`tgPlayers/${sue.playerId}`).get()).exists).toBe(false);
    expect((await db.doc(`tgGames/g1/picks/${sue.playerId}`).get()).exists).toBe(false);
    expect((await db.doc('tgNames/sue').get()).exists).toBe(false);
    await expect(joinPlayer(db, auth, { name: 'Sue' }, NOW)).resolves.toBeTruthy();
    await expectError(act({ action: 'removePlayer', playerId: sue.playerId }), 404);
  });

  it('edits the first-TD-scorer list before kickoff, exactly undoable; not after', async () => {
    const added = { id: '999', name: 'Backup Hero', pos: 'WR', side: 'home' };
    await act({ action: 'editScorers', gameId: 'g2', edits: { added: [added], removed: ['101'] } });
    let g2 = (await db.doc('tgGames/g2').get()).data()!;
    expect(g2.scorers).toEqual([added]);
    await act({ action: 'editScorers', gameId: 'g2', edits: { added: [], removed: [] } });
    g2 = (await db.doc('tgGames/g2').get()).data()!;
    expect(g2.scorers.map((p: { id: string }) => p.id)).toEqual(['101']);
    await expectError(act({ action: 'editScorers', gameId: 'g1', edits: { added: [], removed: ['101'] } }), 409);
    await expectError(act({ action: 'editScorers', gameId: 'g2', edits: { added: [{ id: 'x', name: 'X', pos: 'WR', side: 'home' }] } }), 400);
  });

  it("adjusts a kickoff before the lock, but can't move one that has passed", async () => {
    const later = NOW + 2 * 3_600_000;
    await act({ action: 'setKickoff', gameId: 'g2', kickoffMs: later });
    expect((await db.doc('tgGames/g2').get()).get('kickoff').toMillis()).toBe(later);
    expect((await db.doc('tgGames/g2').get()).get('kickoffOverride').toMillis()).toBe(later);
    await expectError(act({ action: 'setKickoff', gameId: 'g1', kickoffMs: later }), 409, /can't be moved/);
  });

  it('logs every change with a timestamp', async () => {
    await act({ action: 'setSpoilerDelay', seconds: 30 });
    await adminAction(db, auth, ADMIN, { action: 'rescore' }, NOW + 1000);
    const entries = (await db.collection('tgAdminLog').orderBy('at').get()).docs.map((d) => d.data());
    expect(entries.map((e) => [e.action, e.by])).toEqual([['setSpoilerDelay', ADMIN], ['rescore', ADMIN]]);
    expect(entries[0].at.toMillis()).toBe(NOW);
  });

  it('refuses unknown actions', async () => {
    await expectError(act({ action: 'dropTables' }), 400);
  });
});
