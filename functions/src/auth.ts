// The sign-in service (docs/thanksgiving-spec.md, "Players" and "How it's built"):
// joining, logging in with an optional PIN, and setting a PIN. It returns Firebase custom tokens
// whose uid is the player id, which is what lets one player sign in on several devices.

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Auth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { col, contestAt, type Contest } from '../../src/lib/thanksgiving/config';
import { cleanName, isValidPin, nameKey, nameProblem, pinLockMs } from '../../src/lib/thanksgiving/players';

const scrypt = promisify(scryptCb) as (pin: string, salt: Buffer, len: number) => Promise<Buffer>;

export class AuthError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfterSec?: number,
  ) {
    super(message);
  }
}

interface SecretDoc {
  pinHash: string | null; // base64 scrypt
  salt: string | null; // base64
  failures: number;
  lockedUntil: Timestamp | null;
}

async function hashPin(pin: string): Promise<{ pinHash: string; salt: string }> {
  const salt = randomBytes(16);
  const hash = await scrypt(pin, salt, 32);
  return { pinHash: hash.toString('base64'), salt: salt.toString('base64') };
}

async function pinMatches(pin: string, secret: SecretDoc): Promise<boolean> {
  if (!secret.pinHash || !secret.salt) return false;
  const want = Buffer.from(secret.pinHash, 'base64');
  const got = await scrypt(pin, Buffer.from(secret.salt, 'base64'), want.length);
  return timingSafeEqual(want, got);
}

/** Joining closes at the last game's kickoff, since there's nothing left to pick. */
export async function joinClosesAt(db: Firestore, contest: Contest = contestAt(Date.now())): Promise<number | null> {
  const games = await db.collection(col(contest, 'Games')).get();
  let last: number | null = null;
  for (const g of games.docs) {
    const k = g.get('kickoff') as Timestamp | undefined;
    if (k && (last === null || k.toMillis() > last)) last = k.toMillis();
  }
  return last;
}

export async function joinPlayer(
  db: Firestore,
  auth: Auth,
  input: { name?: unknown; pin?: unknown },
  now: number,
  contest: Contest = contestAt(now),
): Promise<{ playerId: string; name: string; token: string }> {
  if (typeof input.name !== 'string') throw new AuthError(400, 'Type a name.');
  const problem = nameProblem(input.name);
  if (problem) throw new AuthError(400, problem);
  const pin = input.pin === undefined || input.pin === null || input.pin === '' ? null : input.pin;
  if (pin !== null && !isValidPin(pin)) throw new AuthError(400, 'A PIN is 4 digits.');

  const closes = await joinClosesAt(db, contest);
  if (closes !== null && now >= closes) throw new AuthError(403, 'Joining is closed: every game has kicked off.');

  const name = cleanName(input.name);
  const hashed = pin ? await hashPin(pin) : { pinHash: null, salt: null };
  const playerId = await createPlayer(db, contest, name, hashed, now);
  if (playerId === null) throw new AuthError(409, `"${name}" is taken. If that's you, pick it from the list of players.`);
  return { playerId, name, token: await auth.createCustomToken(playerId) };
}

/** Creates a player (name index, public player doc, secret) unless the name is taken. Null if taken. */
async function createPlayer(
  db: Firestore,
  contest: Contest,
  name: string,
  hashed: { pinHash: string | null; salt: string | null },
  now: number,
): Promise<string | null> {
  const nameRef = db.collection(col(contest, 'Names')).doc(nameKey(name));
  const playerRef = db.collection(col(contest, 'Players')).doc();
  const secretRef = db.collection(col(contest, 'Secrets')).doc(playerRef.id);
  const created = await db.runTransaction(async (tx) => {
    const taken = await tx.get(nameRef);
    if (taken.exists) return false;
    tx.create(nameRef, { playerId: playerRef.id });
    tx.create(playerRef, { name, hasPin: hashed.pinHash !== null, joinedAt: Timestamp.fromMillis(now) });
    tx.create(secretRef, { ...hashed, failures: 0, lockedUntil: null } satisfies SecretDoc);
    return true;
  });
  return created ? playerRef.id : null;
}

/**
 * Makes sure a practice player (Contest.seedPlayers) exists, without a PIN. True if it was created.
 * Refuses any other name, and every name once the practice is over (no seed players).
 */
export async function ensurePlayer(db: Firestore, contest: Contest, name: string, now: number): Promise<boolean> {
  if (!contest.seedPlayers.includes(name)) throw new Error(`"${name}" isn't a practice player`);
  return (await createPlayer(db, contest, name, { pinHash: null, salt: null }, now)) !== null;
}

export async function loginPlayer(
  db: Firestore,
  auth: Auth,
  input: { playerId?: unknown; pin?: unknown },
  now: number,
  contest: Contest = contestAt(now),
): Promise<{ token: string }> {
  if (typeof input.playerId !== 'string' || !/^[A-Za-z0-9]{1,40}$/.test(input.playerId)) {
    throw new AuthError(400, 'Pick your name from the list.');
  }
  const playerRef = db.collection(col(contest, 'Players')).doc(input.playerId);
  const secretRef = db.collection(col(contest, 'Secrets')).doc(input.playerId);

  // A wrong PIN is recorded in the same transaction that checks it, so guesses can't skip the count.
  type Outcome = 'ok' | { kind: 'locked'; sec: number } | { kind: 'wrong'; sec: number };
  const outcome = await db.runTransaction(async (tx): Promise<Outcome> => {
    const [player, secretSnap] = await Promise.all([tx.get(playerRef), tx.get(secretRef)]);
    if (!player.exists || !secretSnap.exists) throw new AuthError(404, "That player doesn't exist any more.");
    if (!player.get('hasPin')) return 'ok';

    const secret = secretSnap.data() as SecretDoc;
    const lockedUntil = secret.lockedUntil?.toMillis() ?? 0;
    if (lockedUntil > now) {
      return { kind: 'locked', sec: Math.ceil((lockedUntil - now) / 1000) };
    }
    if (typeof input.pin !== 'string' || input.pin === '') throw new AuthError(401, 'Enter your PIN.');
    if (isValidPin(input.pin) && (await pinMatches(input.pin, secret))) {
      if (secret.failures !== 0 || secret.lockedUntil) tx.update(secretRef, { failures: 0, lockedUntil: null });
      return 'ok';
    }
    const failures = secret.failures + 1;
    const lockMs = pinLockMs(failures);
    tx.update(secretRef, { failures, lockedUntil: lockMs > 0 ? Timestamp.fromMillis(now + lockMs) : null });
    return { kind: 'wrong', sec: lockMs > 0 ? Math.ceil(lockMs / 1000) : 0 };
  });

  if (outcome === 'ok') return { token: await auth.createCustomToken(input.playerId) };
  if (outcome.kind === 'locked') {
    throw new AuthError(429, `Too many wrong PINs. Try again in ${waitText(outcome.sec)}.`, outcome.sec);
  }
  if (outcome.sec > 0) {
    throw new AuthError(429, `Wrong PIN. Too many tries: wait ${waitText(outcome.sec)}.`, outcome.sec);
  }
  throw new AuthError(401, 'Wrong PIN.');
}

/** A signed-in player adds or changes their own PIN. */
export async function setPin(
  db: Firestore,
  auth: Auth,
  idToken: unknown,
  pin: unknown,
  contest: Contest = contestAt(Date.now()),
): Promise<void> {
  if (typeof idToken !== 'string' || idToken === '') throw new AuthError(401, 'Sign in first.');
  let uid: string;
  try {
    uid = (await auth.verifyIdToken(idToken)).uid;
  } catch {
    throw new AuthError(401, 'Sign in again.');
  }
  if (!isValidPin(pin)) throw new AuthError(400, 'A PIN is 4 digits.');
  const playerRef = db.collection(col(contest, 'Players')).doc(uid);
  const secretRef = db.collection(col(contest, 'Secrets')).doc(uid);
  const hashed = await hashPin(pin);
  await db.runTransaction(async (tx) => {
    const player = await tx.get(playerRef);
    if (!player.exists) throw new AuthError(404, "That player doesn't exist any more.");
    tx.set(secretRef, { ...hashed, failures: 0, lockedUntil: null } satisfies SecretDoc);
    tx.update(playerRef, { hasPin: true, pinSetAt: FieldValue.serverTimestamp() });
  });
}

function waitText(sec: number): string {
  if (sec < 90) return `${sec} seconds`;
  return `${Math.ceil(sec / 60)} minutes`;
}
