// Browser-side Firebase and sign-in-service access for /thanksgiving. Loaded only by the React island.

import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  browserLocalPersistence,
  connectAuthEmulator,
  indexedDBLocalPersistence,
  initializeAuth,
  onAuthStateChanged,
  signInWithCustomToken,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';

/** Set at build time for tests against the local emulators (see playwright.config.ts). */
const EMULATOR = import.meta.env.PUBLIC_TG_EMULATOR === '1';
const API_BASE: string =
  import.meta.env.PUBLIC_TG_API ?? 'https://us-central1-kylenowski-com.cloudfunctions.net/tg-auth';

export interface Clients {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
}

let clients: Promise<Clients> | null = null;
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
export function getRevealDb(gameId: string): Promise<Firestore> {
  let db = revealDbs.get(gameId);
  if (!db) {
    db = (async () => {
      const app = initializeApp(await loadConfig(), `reveal-${gameId}`);
      const fs = getFirestore(app);
      if (EMULATOR) connectFirestoreEmulator(fs, '127.0.0.1', 8080);
      return fs;
    })();
    revealDbs.set(gameId, db);
  }
  return db;
}

export function getClients(): Promise<Clients> {
  clients ??= (async () => {
    const app = initializeApp(await loadConfig());
    // initializeAuth without a popup/redirect resolver: sign-in here is by custom token only, and
    // the resolver would load a script from apis.google.com that the CSP (rightly) blocks.
    const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
    const db = getFirestore(app);
    if (EMULATOR) {
      connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      connectFirestoreEmulator(db, '127.0.0.1', 8080);
    }
    return { app, auth, db };
  })();
  return clients;
}

export function watchUser(auth: Auth, cb: (u: User | null) => void): () => void {
  return onAuthStateChanged(auth, cb);
}

export class ApiError extends Error {}

async function post<T>(path: string, body: unknown, idToken?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
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

export async function join(auth: Auth, name: string, pin: string): Promise<void> {
  const { token } = await post<{ token: string }>('/join', { name, pin: pin || undefined });
  await signInWithCustomToken(auth, token);
}

export async function login(auth: Auth, playerId: string, pin: string): Promise<void> {
  const { token } = await post<{ token: string }>('/login', { playerId, pin: pin || undefined });
  await signInWithCustomToken(auth, token);
}

export async function changePin(auth: Auth, pin: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new ApiError('Sign in first.');
  await post('/pin', { pin }, await user.getIdToken());
}

export function switchPlayer(auth: Auth): Promise<void> {
  return signOut(auth);
}
