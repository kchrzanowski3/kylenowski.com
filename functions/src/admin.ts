// The admin service (docs/thanksgiving-spec.md, "Admin"): everything the admin screen changes goes
// through here, so Firestore rules never have to let a browser write game data. Only Kyle's email
// address, signed in with an emailed link (so verified), may call it. Every change is logged in
// tgAdminLog, and changes that affect points re-score at once.

import type { Auth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { col, contestAt, type CollectionName, type Contest } from '../../src/lib/thanksgiving/config';
import { canSetKickoff } from '../../src/lib/thanksgiving/kickoff';
import { cleanName, nameKey, nameProblem } from '../../src/lib/thanksgiving/players';
import { OVERRIDABLE, type OverrideKey } from '../../src/lib/thanksgiving/scoring';
import { applyScorerEdits } from '../../src/lib/thanksgiving/scorers';
import type { ScorerEdits, ScorerOption } from '../../src/lib/thanksgiving/types';
import { AuthError } from './auth';
import { SPOILER_DELAY_MAX_SEC, publish as publishContest } from './live';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Verifies the caller is the admin: the configured address, verified by the emailed link. */
export async function verifyAdmin(auth: Auth, idToken: unknown, adminEmail: string): Promise<string> {
  if (!adminEmail) throw new AuthError(500, 'The admin address is not configured.');
  if (typeof idToken !== 'string' || idToken === '') throw new AuthError(401, 'Sign in first.');
  let token;
  try {
    token = await auth.verifyIdToken(idToken, true);
  } catch {
    throw new AuthError(401, 'Sign in again.');
  }
  if (token.email?.toLowerCase() !== adminEmail.toLowerCase() || token.email_verified !== true) {
    throw new AuthError(403, 'Only the admin can do that.');
  }
  return token.email.toLowerCase();
}

/**
 * Makes sure the admin's account exists (with no password) before anyone else could register the
 * address with a password of their own and later get into it.
 */
export async function ensureAdminUser(auth: Auth, adminEmail: string): Promise<void> {
  if (!adminEmail) return;
  try {
    await auth.getUserByEmail(adminEmail);
  } catch (e: any) {
    if (e?.code !== 'auth/user-not-found') throw e;
    await auth.createUser({ email: adminEmail, emailVerified: false });
  }
}

const isInt = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const isSide = (v: unknown) => v === 'away' || v === 'home';
const pair = (v: any) => v && typeof v === 'object' && isInt(v.away, 0, 200) && isInt(v.home, 0, 200);

/** Checks an override value's shape. */
export function overrideProblem(key: string, value: unknown): string | null {
  if (!(OVERRIDABLE as readonly string[]).includes(key)) return `"${key}" can't be overridden`;
  if (value === null) return null; // clears the override
  const ok: Record<OverrideKey, () => boolean> = {
    state: () => value === 'pre' || value === 'in' || value === 'post',
    away: () => isInt(value, 0, 200),
    home: () => isInt(value, 0, 200),
    firstScore: () => !!value && isSide((value as any).side) && ['td', 'fg', 'safety'].includes((value as any).type),
    firstTd: () => !!value && isSide((value as any).side) && typeof (value as any).scorerName === 'string'
      && ((value as any).scorerId === null || /^[0-9]{1,12}$/.test(String((value as any).scorerId))),
    halftimeReached: () => typeof value === 'boolean',
    halftime: () => pair(value),
    passTds: () => pair(value),
    rushTds: () => pair(value),
    missedKick: () => typeof value === 'boolean',
    leadChange4q: () => typeof value === 'boolean',
    fgs: () => isInt(value, 0, 40),
    punts: () => isInt(value, 0, 40),
    tds: () => isInt(value, 0, 40),
    turnovers: () => isInt(value, 0, 40),
    longestTd: () => isInt(value, 0, 109),
    sacks: () => isInt(value, 0, 40),
  };
  return ok[key as OverrideKey]() ? null : `bad value for ${key}`;
}

const GAME_ID = /^[A-Za-z0-9]{1,40}$/;
const PLAYER_ID = /^[A-Za-z0-9]{1,40}$/;

async function logEntry(db: Firestore, contest: Contest, by: string, action: string, details: Record<string, unknown>, now: number) {
  await db.collection(col(contest, 'AdminLog')).add({ at: Timestamp.fromMillis(now), by, action, details });
}

async function findGame(db: Firestore, contest: Contest, gameId: unknown) {
  if (typeof gameId !== 'string' || !GAME_ID.test(gameId)) throw new AuthError(400, 'Unknown game.');
  const ref = db.doc(`${col(contest, 'Games')}/${gameId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new AuthError(404, 'Unknown game.');
  return { ref, snap, id: gameId };
}

async function findPlayer(db: Firestore, contest: Contest, playerId: unknown) {
  if (typeof playerId !== 'string' || !PLAYER_ID.test(playerId)) throw new AuthError(400, 'Unknown player.');
  const ref = db.doc(`${col(contest, 'Players')}/${playerId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new AuthError(404, 'Unknown player.');
  return { ref, snap, id: playerId };
}

/** Runs one admin action. Returns what the admin screen shows afterwards. */
export async function adminAction(
  db: Firestore,
  auth: Auth,
  by: string,
  body: any,
  now: number,
  contest: Contest = contestAt(now),
): Promise<Record<string, unknown>> {
  const action = String(body?.action ?? '');
  const c = (name: CollectionName) => col(contest, name);
  const log = (what: string, details: Record<string, unknown>) => logEntry(db, contest, by, what, details, now);
  const gameRef = (gameId: unknown) => findGame(db, contest, gameId);
  const playerRef = (playerId: unknown) => findPlayer(db, contest, playerId);
  const publish = (d: Firestore, t: number) => publishContest(d, t, undefined, contest);
  switch (action) {
    case 'setOverride': {
      const g = await gameRef(body.gameId);
      const problem = overrideProblem(String(body.key), body.value);
      if (problem) throw new AuthError(400, problem);
      await db.doc(`${c('Overrides')}/${g.id}`).set(
        { stats: { [body.key]: body.value === null ? FieldValue.delete() : body.value }, updatedAt: Timestamp.fromMillis(now) },
        { merge: true },
      );
      await log(action, { gameId: g.id, key: body.key, value: body.value });
      return { ok: true, publish: await publish(db, now) };
    }
    case 'setPaused': {
      const g = await gameRef(body.gameId);
      if (typeof body.paused !== 'boolean') throw new AuthError(400, 'paused must be true or false.');
      await db.doc(`${c('Overrides')}/${g.id}`).set({ paused: body.paused, updatedAt: Timestamp.fromMillis(now) }, { merge: true });
      await log(action, { gameId: g.id, paused: body.paused });
      return { ok: true };
    }
    case 'rescore': {
      await log(action, {});
      return { ok: true, publish: await publish(db, now) };
    }
    case 'setSpoilerDelay': {
      if (!isInt(body.seconds, 0, SPOILER_DELAY_MAX_SEC)) throw new AuthError(400, `The delay is 0–${SPOILER_DELAY_MAX_SEC} seconds.`);
      await db.doc(`${c('Meta')}/config`).set({ spoilerDelaySec: body.seconds }, { merge: true });
      await log(action, { seconds: body.seconds });
      return { ok: true, publish: await publish(db, now) }; // takes effect immediately
    }
    case 'renamePlayer': {
      const p = await playerRef(body.playerId);
      if (typeof body.name !== 'string') throw new AuthError(400, 'Type a name.');
      const problem = nameProblem(body.name);
      if (problem) throw new AuthError(400, problem);
      const name = cleanName(body.name);
      const oldKey = nameKey(p.snap.get('name'));
      const newKey = nameKey(name);
      await db.runTransaction(async (tx) => {
        if (newKey !== oldKey) {
          const taken = await tx.get(db.doc(`${c('Names')}/${newKey}`));
          if (taken.exists) throw new AuthError(409, `"${name}" is taken.`);
          tx.delete(db.doc(`${c('Names')}/${oldKey}`));
          tx.create(db.doc(`${c('Names')}/${newKey}`), { playerId: p.id });
        }
        tx.update(p.ref, { name });
      });
      await log(action, { playerId: p.id, from: p.snap.get('name'), to: name });
      return { ok: true, publish: await publish(db, now) };
    }
    case 'resetPin': {
      const p = await playerRef(body.playerId);
      await db.doc(`${c('Secrets')}/${p.id}`).set({ pinHash: null, salt: null, failures: 0, lockedUntil: null });
      await p.ref.update({ hasPin: false });
      await log(action, { playerId: p.id, name: p.snap.get('name') });
      return { ok: true };
    }
    case 'removePlayer': {
      const p = await playerRef(body.playerId);
      const games = await db.collection(c('Games')).get();
      const batch = db.batch();
      for (const g of games.docs) batch.delete(db.doc(`${c('Games')}/${g.id}/picks/${p.id}`));
      batch.delete(p.ref);
      batch.delete(db.doc(`${c('Secrets')}/${p.id}`));
      batch.delete(db.doc(`${c('Names')}/${nameKey(p.snap.get('name'))}`));
      await batch.commit();
      await auth.revokeRefreshTokens(p.id).catch(() => {}); // signed-in phones lose access
      await log(action, { playerId: p.id, name: p.snap.get('name') });
      return { ok: true, publish: await publish(db, now) };
    }
    case 'editScorers': {
      const g = await gameRef(body.gameId);
      const kickoff = (g.snap.get('kickoff') as Timestamp).toMillis();
      if (now >= kickoff) throw new AuthError(409, 'This game has kicked off; its list is final.');
      const edits = parseEdits(body.edits);
      const base = (g.snap.get('scorersFeed') ?? g.snap.get('scorers') ?? []) as ScorerOption[];
      await g.ref.update({ scorerEdits: edits, scorers: applyScorerEdits(base, edits) });
      await log(action, { gameId: g.id, edits });
      return { ok: true };
    }
    case 'setKickoff': {
      const g = await gameRef(body.gameId);
      const stored = (g.snap.get('kickoff') as Timestamp).toMillis();
      if (!canSetKickoff(stored, now)) throw new AuthError(409, "This game's lock has passed; it can't be moved (picks have been revealed).");
      if (!isInt(body.kickoffMs, now - 86_400_000, now + 30 * 86_400_000)) throw new AuthError(400, 'Pick a time.');
      await g.ref.update({ kickoff: Timestamp.fromMillis(body.kickoffMs), kickoffOverride: Timestamp.fromMillis(body.kickoffMs) });
      await log(action, { gameId: g.id, from: new Date(stored).toISOString(), to: new Date(body.kickoffMs).toISOString() });
      return { ok: true };
    }
    default:
      throw new AuthError(400, 'Unknown action.');
  }
}

function parseEdits(v: any): ScorerEdits {
  const removed = Array.isArray(v?.removed) ? v.removed.filter((x: unknown) => typeof x === 'string' && /^[0-9]{1,12}$/.test(x)) : [];
  const added: ScorerOption[] = [];
  for (const p of Array.isArray(v?.added) ? v.added : []) {
    if (typeof p?.id !== 'string' || !/^[0-9]{1,12}$/.test(p.id)) throw new AuthError(400, 'An added player needs an ESPN athlete id.');
    if (typeof p.name !== 'string' || p.name.trim() === '' || p.name.length > 60) throw new AuthError(400, 'An added player needs a name.');
    if (!['QB', 'RB', 'WR', 'TE'].includes(p.pos)) throw new AuthError(400, 'Position must be QB, RB, WR or TE.');
    if (!isSide(p.side)) throw new AuthError(400, 'Pick the team.');
    added.push({ id: p.id, name: p.name.trim(), pos: p.pos, side: p.side });
  }
  return { added, removed };
}
