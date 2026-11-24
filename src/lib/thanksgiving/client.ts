// Browser-side Firebase and sign-in-service access for /thanksgiving (and /thanksgiving-test).
// Loaded only by the React island. Everything takes the page's contest (config.ts): its
// collections, and ?contest= on calls to the functions for any contest but the real one.

import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  browserLocalPersistence,
  connectAuthEmulator,
  indexedDBLocalPersistence,
  initializeAuth,
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signInWithCustomToken,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
import { REAL_CONTEST, type Contest } from './config';

/** Set at build time for tests against the local emulators (see playwright.config.ts). */
const EMULATOR = import.meta.env.PUBLIC_TG_EMULATOR === '1';
const API_BASE: string =
  import.meta.env.PUBLIC_TG_API ?? 'https://us-central1-kylenowski-com.cloudfunctions.net/tg-auth';

export interface Clients {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  contest: Contest;
}

/** The query string that names a contest to the functions: none for the real one. */
export function contestQuery(contest: Contest): string {
  return contest.id === REAL_CONTEST.id ? '' : `?contest=${encodeURIComponent(contest.id)}`;
}

const clientsByContest = new Map<string, Promise<Clients>>();
let config: Promise<Record<string, string>> | null = null;

/** Firebase Hosting serves the project's web-app config at this reserved URL. */
function loadConfig(): Promise<Record<string, string>> {
  config ??= (async () => {
    if (EMULATOR) return { apiKey: 'demo-key', projectId: 'demo-kylenowski', authDomain: '127.0.0.1' };
    const res = await fetch('/__/firebase/init.json');
    if (!res.ok) throw new Error(`Couldn't load the Firebase config (HTTP ${res.status}).`);
    return res.json();
  })();
  return config;
}

const revealDbs = new Map<string, Promise<Firestore>>();

/**
 * A separate, signed-out Firestore connection for one game's revealed picks, opened once the game
 * has kicked off. The reveal rule compares request.time with kickoff, and a query added to a
 * connection that was already open before kickoff can be refused (the emulator, at least, has no
 * request.time for it). Revealed picks are public, so this connection needs no sign-in.
 */
export function getRevealDb(contest: Contest, gameId: string): Promise<Firestore> {
  const name = `reveal-${contest.prefix}-${gameId}`;
  let db = revealDbs.get(name);
  if (!db) {
    db = (async () => {
      const app = initializeApp(await loadConfig(), name);
      const fs = getFirestore(app);
      if (EMULATOR) connectFirestoreEmulator(fs, '127.0.0.1', 8080);
      return fs;
    })();
    revealDbs.set(name, db);
  }
  return db;
}

/**
 * The player's Firebase connection for a contest. The real contest uses the default app, as it
 * always has; any other contest gets an app of its own, so a test sign-in never replaces (or is
 * mistaken for) a real one in the same browser.
 */
export function getClients(contest: Contest = REAL_CONTEST): Promise<Clients> {
  let clients = clientsByContest.get(contest.id);
  if (clients) return clients;
  clients = (async () => {
    const app = contest.id === REAL_CONTEST.id ? initializeApp(await loadConfig()) : initializeApp(await loadConfig(), `player-${contest.id}`);
    // initializeAuth without a popup/redirect resolver: sign-in here is by custom token only, and
    // the resolver would load a script from apis.google.com that the CSP (rightly) blocks.
    const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
    const db = getFirestore(app);
    if (EMULATOR) {
      connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      connectFirestoreEmulator(db, '127.0.0.1', 8080);
    }
    return { app, auth, db, contest };
  })();
  clientsByContest.set(contest.id, clients);
  return clients;
}

export function watchUser(auth: Auth, cb: (u: User | null) => void): () => void {
  return onAuthStateChanged(auth, cb);
}

export class ApiError extends Error {}

async function post<T>(contest: Contest, path: string, body: unknown, idToken?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}${contestQuery(contest)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(idToken ? { authorization: `Bearer ${idToken}` } : {}) },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Couldn't reach the server. Check your connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Something went wrong (HTTP ${res.status}).`);
  return data as T;
}

export async function join({ auth, contest }: Clients, name: string, pin: string): Promise<void> {
  const { token } = await post<{ token: string }>(contest, '/join', { name, pin: pin || undefined });
  await signInWithCustomToken(auth, token);
}

export async function login({ auth, contest }: Clients, playerId: string, pin: string): Promise<void> {
  const { token } = await post<{ token: string }>(contest, '/login', { playerId, pin: pin || undefined });
  await signInWithCustomToken(auth, token);
}

export async function changePin({ auth, contest }: Clients, pin: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new ApiError('Sign in first.');
  await post(contest, '/pin', { pin }, await user.getIdToken());
}

export function switchPlayer(auth: Auth): Promise<void> {
  return signOut(auth);
}

// --- Admin (/thanksgiving/admin, /thanksgiving-test/admin) -------------------------------------
// A separate Firebase app instance, so the admin's sign-in never replaces a player sign-in in the
// same browser. Both contests' admin screens share it: it's the same admin.

const ADMIN_API: string =
  import.meta.env.PUBLIC_TG_ADMIN_API ?? 'https://us-central1-kylenowski-com.cloudfunctions.net/tg-admin';
const ADMIN_EMAIL_KEY = 'tgAdminEmail';
let adminClients: Promise<Omit<Clients, 'contest'>> | null = null;

export async function getAdminClients(contest: Contest = REAL_CONTEST): Promise<Clients> {
  adminClients ??= (async () => {
    const app = initializeApp(await loadConfig(), 'admin');
    const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
    const db = getFirestore(app);
    if (EMULATOR) {
      connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      connectFirestoreEmulator(db, '127.0.0.1', 8080);
    }
    return { app, auth, db };
  })();
  return { ...(await adminClients), contest };
}

/** Emails a one-time sign-in link that comes back to this page. */
export async function sendAdminLink({ auth, contest }: Clients, email: string): Promise<void> {
  await sendSignInLinkToEmail(auth, email, { url: `${location.origin}${contest.path}/admin`, handleCodeInApp: true });
  try {
    localStorage.setItem(ADMIN_EMAIL_KEY, email);
  } catch {
    // private window: we'll ask for the address again when the link is opened
  }
}

/** If this page was opened from the emailed link, finishes signing in. Returns true if it did. */
export async function completeAdminLink(auth: Auth, askEmail: () => string | null): Promise<boolean> {
  if (!isSignInWithEmailLink(auth, location.href)) return false;
  let email: string | null = null;
  try {
    email = localStorage.getItem(ADMIN_EMAIL_KEY);
  } catch {
    email = null;
  }
  email ??= askEmail();
  if (!email) return false;
  await signInWithEmailLink(auth, email, location.href);
  history.replaceState(null, '', location.pathname); // drop the one-time code from the address bar
  return true;
}

export async function adminCall<T = Record<string, unknown>>({ auth, contest }: Clients, body: Record<string, unknown>): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new ApiError('Sign in first.');
  let res: Response;
  try {
    res = await fetch(`${ADMIN_API}${contestQuery(contest)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${await user.getIdToken()}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Couldn't reach the admin service.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Something went wrong (HTTP ${res.status}).`);
  return data as T;
}
