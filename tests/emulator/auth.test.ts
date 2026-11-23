// The sign-in service (docs/thanksgiving-spec.md, Testing §4), against the Firestore and Auth emulators.
import { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthError, joinPlayer, loginPlayer, setPin } from '../../functions/src/auth';
import { FREE_PIN_GUESSES } from '../../src/lib/thanksgiving/players';
import { auth, clearFirestore, db, signInOnNewDevice } from './admin-app';

const NOW = Date.parse('2026-11-25T15:00:00Z');
const HOUR = 3_600_000;

async function expectError(p: Promise<unknown>, status: number, message?: RegExp) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AuthError);
  expect((err as AuthError).status).toBe(status);
  if (message) expect((err as AuthError).message).toMatch(message);
}

beforeEach(async () => {
  await clearFirestore();
  // Thursday's games: the last one kicks off at 8:20 PM ET.
  const kickoffs = ['2026-11-26T18:00:00Z', '2026-11-26T21:30:00Z', '2026-11-27T01:20:00Z'];
  for (const [i, k] of kickoffs.entries()) {
    await db.doc(`tgGames/g${i + 1}`).set({ order: i + 1, kickoff: Timestamp.fromMillis(Date.parse(k)) });
  }
});

describe('joining', () => {
  it('creates a player and signs them in', async () => {
    const r = await joinPlayer(db, auth, { name: '  Aunt   Sue ' }, NOW);
    expect(r.name).toBe('Aunt Sue');
    const player = await db.doc(`tgPlayers/${r.playerId}`).get();
    expect(player.data()).toMatchObject({ name: 'Aunt Sue', hasPin: false });
    expect((await signInOnNewDevice(r.token)).uid).toBe(r.playerId);
  });

  it('refuses a name already taken, ignoring case', async () => {
    await joinPlayer(db, auth, { name: 'Kyle' }, NOW);
    await expectError(joinPlayer(db, auth, { name: 'kyle' }, NOW), 409, /taken/);
    await expectError(joinPlayer(db, auth, { name: ' KYLE ' }, NOW), 409);
  });

  it('refuses bad names and PINs', async () => {
    await expectError(joinPlayer(db, auth, { name: '' }, NOW), 400);
    await expectError(joinPlayer(db, auth, { name: '<b>hi</b>' }, NOW), 400);
    await expectError(joinPlayer(db, auth, { name: 'Sue', pin: '12' }, NOW), 400);
    await expectError(joinPlayer(db, auth, { name: 'Sue', pin: 1234 }, NOW), 400);
  });

  it('stores the PIN hashed, never as typed', async () => {
    const r = await joinPlayer(db, auth, { name: 'Sue', pin: '4321' }, NOW);
    const secret = (await db.doc(`tgSecrets/${r.playerId}`).get()).data()!;
    expect(secret.pinHash).toBeTruthy();
    expect(JSON.stringify(secret)).not.toContain('4321');
    expect((await db.doc(`tgPlayers/${r.playerId}`).get()).get('hasPin')).toBe(true);
  });

  it("closes at game 3's kickoff", async () => {
    const lastKickoff = Date.parse('2026-11-27T01:20:00Z');
    await expect(joinPlayer(db, auth, { name: 'Late' }, lastKickoff - 1)).resolves.toBeTruthy();
    await expectError(joinPlayer(db, auth, { name: 'Later' }, lastKickoff), 403, /closed/);
  });
});

describe('logging in', () => {
  it('a name without a PIN can be picked by anyone', async () => {
    const { playerId } = await joinPlayer(db, auth, { name: 'Grandpa' }, NOW);
    const { token } = await loginPlayer(db, auth, { playerId }, NOW);
    expect((await signInOnNewDevice(token)).uid).toBe(playerId);
  });

  it('a PIN-protected name needs the right PIN, and then works on a new device', async () => {
    const { playerId } = await joinPlayer(db, auth, { name: 'Bob', pin: '2468' }, NOW);
    await expectError(loginPlayer(db, auth, { playerId }, NOW), 401, /PIN/);
    await expectError(loginPlayer(db, auth, { playerId, pin: '1111' }, NOW), 401, /Wrong PIN/);
    const { token } = await loginPlayer(db, auth, { playerId, pin: '2468' }, NOW);
    expect((await signInOnNewDevice(token)).uid).toBe(playerId);
  });

  it('slows down repeated wrong guesses, even when the right PIN comes next', async () => {
    const { playerId } = await joinPlayer(db, auth, { name: 'Bob', pin: '2468' }, NOW);
    for (let i = 1; i < FREE_PIN_GUESSES; i++) {
      await expectError(loginPlayer(db, auth, { playerId, pin: '0000' }, NOW), 401);
    }
    await expectError(loginPlayer(db, auth, { playerId, pin: '0000' }, NOW), 429, /wait 60 seconds/);
    // Locked: the right PIN is refused until the wait is over.
    await expectError(loginPlayer(db, auth, { playerId, pin: '2468' }, NOW + 1_000), 429, /Try again/);
    // After the wait, the right PIN works and the count resets.
    await expect(loginPlayer(db, auth, { playerId, pin: '2468' }, NOW + 61_000)).resolves.toHaveProperty('token');
    await expectError(loginPlayer(db, auth, { playerId, pin: '0000' }, NOW + 62_000), 401);
  });

  it('each further wrong guess doubles the wait', async () => {
    const { playerId } = await joinPlayer(db, auth, { name: 'Bob', pin: '2468' }, NOW);
    let t = NOW;
    for (let i = 1; i <= FREE_PIN_GUESSES; i++) await loginPlayer(db, auth, { playerId, pin: '0000' }, t).catch(() => {});
    t += 61_000;
    await expectError(loginPlayer(db, auth, { playerId, pin: '0000' }, t), 429, /wait 2 minutes/);
  });

  it("refuses a player that doesn't exist", async () => {
    await expectError(loginPlayer(db, auth, { playerId: 'nobody' }, NOW), 404);
    await expectError(loginPlayer(db, auth, { playerId: '../x' }, NOW), 400);
  });

  it('still works after Thanksgiving (read-only archive)', async () => {
    const { playerId } = await joinPlayer(db, auth, { name: 'Sue' }, NOW);
    await expect(loginPlayer(db, auth, { playerId }, NOW + 30 * 24 * HOUR)).resolves.toHaveProperty('token');
  });
});

describe('setting a PIN', () => {
  it('a signed-in player can add a PIN, and then it is needed', async () => {
    const r = await joinPlayer(db, auth, { name: 'Sue' }, NOW);
    const { idToken } = await signInOnNewDevice(r.token);
    await setPin(db, auth, idToken, '1357');
    expect((await db.doc(`tgPlayers/${r.playerId}`).get()).get('hasPin')).toBe(true);
    await expectError(loginPlayer(db, auth, { playerId: r.playerId }, NOW), 401);
    await expect(loginPlayer(db, auth, { playerId: r.playerId, pin: '1357' }, NOW)).resolves.toHaveProperty('token');
  });

  it('a signed-in player can change their PIN', async () => {
    const r = await joinPlayer(db, auth, { name: 'Sue', pin: '1111' }, NOW);
    const { idToken } = await signInOnNewDevice(r.token);
    await setPin(db, auth, idToken, '2222');
    await expectError(loginPlayer(db, auth, { playerId: r.playerId, pin: '1111' }, NOW), 401);
    await expect(loginPlayer(db, auth, { playerId: r.playerId, pin: '2222' }, NOW)).resolves.toHaveProperty('token');
  });

  it('needs a valid sign-in and a 4-digit PIN', async () => {
    const r = await joinPlayer(db, auth, { name: 'Sue' }, NOW);
    await expectError(setPin(db, auth, '', '1234'), 401);
    await expectError(setPin(db, auth, 'not-a-token', '1234'), 401);
    const { idToken } = await signInOnNewDevice(r.token);
    await expectError(setPin(db, auth, idToken, '12a4'), 400);
  });
});
