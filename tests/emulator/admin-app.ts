// A firebase-admin app and a client-SDK "device" pointed at the emulators
// (firebase emulators:exec sets FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST).
import { deleteApp as deleteClientApp, initializeApp as initClient } from 'firebase/app';
import { connectAuthEmulator, getAuth as getClientAuth, signInWithCustomToken } from 'firebase/auth';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

export const PROJECT = 'demo-kylenowski';

const app = getApps().find((a) => a.name === 'tests') ?? initializeApp({ projectId: PROJECT }, 'tests');
export const db = getFirestore(app);
export const auth = getAuth(app);

export async function clearFirestore(): Promise<void> {
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
}

let devices = 0;

/** Signs in with a custom token on a fresh client "device"; returns its uid and an ID token. */
export async function signInOnNewDevice(token: string): Promise<{ uid: string; idToken: string }> {
  const client = initClient({ apiKey: 'demo-key', projectId: PROJECT }, `device-${++devices}`);
  const clientAuth = getClientAuth(client);
  connectAuthEmulator(clientAuth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099'}`, {
    disableWarnings: true,
  });
  const cred = await signInWithCustomToken(clientAuth, token);
  const out = { uid: cred.user.uid, idToken: await cred.user.getIdToken() };
  await deleteClientApp(client);
  return out;
}
