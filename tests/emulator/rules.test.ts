// Firestore security rules (docs/thanksgiving-spec.md, Testing §3), against the Firestore emulator.
import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import { setLogLevel } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

setLogLevel('silent'); // denied writes are expected here; don't log each one

let env: RulesTestEnvironment;
const HOUR = 3_600_000;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-kylenowski',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(() => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = fs(ctx);
    // "upcoming" kicks off in an hour; "started" kicked off an hour ago.
    await setDoc(doc(db, 'tgGames/upcoming'), { order: 2, kickoff: Timestamp.fromMillis(Date.now() + HOUR) });
    await setDoc(doc(db, 'tgGames/started'), { order: 1, kickoff: Timestamp.fromMillis(Date.now() - HOUR) });
    await setDoc(doc(db, 'tgPlayers/alice'), { name: 'Alice', hasPin: false });
    await setDoc(doc(db, 'tgPlayers/bob'), { name: 'Bob', hasPin: true });
    await setDoc(doc(db, 'tgSecrets/bob'), { pinHash: 'x', salt: 'y', failures: 0, lockedUntil: null });
    await setDoc(doc(db, 'tgNames/bob'), { playerId: 'bob' });
    await setDoc(doc(db, 'tgMeta/refresh'), { games: 3 });
    for (const g of ['upcoming', 'started']) {
      await setDoc(doc(db, `tgGames/${g}/picks/bob`), { answers: { punts: 8 }, updatedAt: Timestamp.now() });
    }
  });
});

// The test contexts hand back the compat Firestore type; the modular functions accept it.
const fs = (ctx: { firestore(): unknown }) => ctx.firestore() as Firestore;
const alice = () => fs(env.authenticatedContext('alice'));
const bob = () => fs(env.authenticatedContext('bob'));
const anon = () => fs(env.unauthenticatedContext());
const pick = (answers: Record<string, unknown>) => ({ answers, updatedAt: serverTimestamp() });
const save = (db: Firestore, game: string, player: string, answers: Record<string, unknown>) =>
  setDoc(doc(db, `tgGames/${game}/picks/${player}`), pick(answers));

describe('writing picks', () => {
  it('a player can save their own picks before kickoff, and change them', async () => {
    await assertSucceeds(save(alice(), 'upcoming', 'alice', { punts: 7, finalAway: 20, finalHome: 24 }));
    await assertSucceeds(save(alice(), 'upcoming', 'alice', { punts: 9 }));
    await assertSucceeds(save(bob(), 'upcoming', 'bob', { sacks: 4 }));
  });

  it("a player can't write someone else's picks", async () => {
    await assertFails(save(alice(), 'upcoming', 'bob', { punts: 1 }));
    await assertFails(updateDoc(doc(alice(), 'tgGames/upcoming/picks/bob'), { answers: { punts: 1 } }));
  });

  it("picks lock at kickoff: no new or changed picks after it", async () => {
    await assertFails(save(alice(), 'started', 'alice', { punts: 7 }));
    await assertFails(save(bob(), 'started', 'bob', { punts: 9 }));
  });

  it("can't be deleted (a skipped game is just no picks)", async () => {
    await assertFails(deleteDoc(doc(bob(), 'tgGames/upcoming/picks/bob')));
  });

  it('needs a signed-in player who exists', async () => {
    await assertFails(save(anon(), 'upcoming', 'alice', { punts: 7 }));
    const stranger = fs(env.authenticatedContext('carol')); // signed in, but not a player
    await assertFails(save(stranger, 'upcoming', 'carol', { punts: 7 }));
  });

  it("can't be made for a game that doesn't exist", async () => {
    await assertFails(save(alice(), 'nope', 'alice', { punts: 7 }));
  });

  it('must be valid answers', async () => {
    await assertFails(save(alice(), 'upcoming', 'alice', { finalAway: 21, finalHome: 21 })); // tie
    await assertFails(save(alice(), 'upcoming', 'alice', { finalAway: 21 })); // half a score
    await assertFails(save(alice(), 'upcoming', 'alice', { punts: 2.5 }));
    await assertFails(save(alice(), 'upcoming', 'alice', { punts: 31 }));
    await assertFails(save(alice(), 'upcoming', 'alice', { firstTeam: 'tie' }));
    await assertFails(save(alice(), 'upcoming', 'alice', { firstScoreType: 'xp' }));
    await assertFails(save(alice(), 'upcoming', 'alice', { firstTdScorer: 'Dak Prescott' }));
    await assertFails(save(alice(), 'upcoming', 'alice', { missedKick: 'yes' }));
    await assertFails(save(alice(), 'upcoming', 'alice', { bonus: 3 }));
    await assertSucceeds(
      save(alice(), 'upcoming', 'alice', {
        finalAway: 20, finalHome: 27, firstTeam: 'home', firstScoreType: 'safety', firstTdScorer: 'other',
        halftime: 'tie', passTds: 'away', rushTds: 'tie', missedKick: true, leadChange4q: false,
        fgs: 3, punts: 8, tds: 6, turnovers: 2, longestTd: 0, sacks: 5,
      }),
    );
  });

  it('must use the server time and no extra fields', async () => {
    const ref = doc(alice(), 'tgGames/upcoming/picks/alice');
    await assertFails(setDoc(ref, { answers: { punts: 7 }, updatedAt: Timestamp.fromMillis(0) }));
    await assertFails(setDoc(ref, { answers: { punts: 7 }, updatedAt: serverTimestamp(), score: 37 }));
  });
});

describe('reading picks', () => {
  it('a player can read their own picks before kickoff', async () => {
    await assertSucceeds(getDoc(doc(bob(), 'tgGames/upcoming/picks/bob')));
  });

  it("other players' picks are hidden until kickoff", async () => {
    await assertFails(getDoc(doc(alice(), 'tgGames/upcoming/picks/bob')));
    await assertFails(getDocs(collection(alice(), 'tgGames/upcoming/picks')));
    await assertFails(getDoc(doc(anon(), 'tgGames/upcoming/picks/bob')));
  });

  it('no account can see them before kickoff, whatever its sign-in (the admin screen included)', async () => {
    const admin = fs(env.authenticatedContext('kyle-admin', { email: 'admin@example.com', email_verified: true, admin: true }));
    await assertFails(getDoc(doc(admin, 'tgGames/upcoming/picks/bob')));
    await assertFails(getDocs(collection(admin, 'tgGames/upcoming/picks')));
  });

  it('after kickoff, everyone can see everyone\'s picks, without signing in', async () => {
    await assertSucceeds(getDoc(doc(alice(), 'tgGames/started/picks/bob')));
    await assertSucceeds(getDocs(collection(alice(), 'tgGames/started/picks')));
    await assertSucceeds(getDocs(collection(anon(), 'tgGames/started/picks')));
  });
});

describe('everything else', () => {
  it('standings data, the player list and games are public', async () => {
    await assertSucceeds(getDocs(collection(anon(), 'tgGames')));
    await assertSucceeds(getDocs(collection(anon(), 'tgPlayers')));
    await assertSucceeds(getDoc(doc(anon(), 'tgMeta/refresh')));
  });

  it('PINs and the name index are never readable', async () => {
    await assertFails(getDoc(doc(anon(), 'tgSecrets/bob')));
    await assertFails(getDoc(doc(bob(), 'tgSecrets/bob')));
    await assertFails(getDoc(doc(bob(), 'tgNames/bob')));
    await assertFails(getDocs(collection(alice(), 'tgSeasonGames')));
  });

  it("a PIN-protected name can't be taken over by writing player data directly", async () => {
    await assertFails(setDoc(doc(alice(), 'tgPlayers/bob'), { name: 'Bob', hasPin: false }));
    await assertFails(updateDoc(doc(bob(), 'tgPlayers/bob'), { hasPin: false }));
    await assertFails(setDoc(doc(alice(), 'tgSecrets/bob'), { pinHash: null }));
    await assertFails(setDoc(doc(alice(), 'tgNames/bob'), { playerId: 'alice' }));
    await assertFails(setDoc(doc(alice(), 'tgPlayers/alice2'), { name: 'Alice 2', hasPin: false }));
  });

  it("clients can't change games, so they can't move a kickoff to reopen picks", async () => {
    await assertFails(updateDoc(doc(alice(), 'tgGames/started'), { kickoff: Timestamp.fromMillis(Date.now() + HOUR) }));
    await assertFails(setDoc(doc(alice(), 'tgGames/new'), { kickoff: Timestamp.fromMillis(Date.now() + HOUR) }));
    await assertFails(setDoc(doc(alice(), 'tgMeta/refresh'), { games: 0 }));
  });
});
