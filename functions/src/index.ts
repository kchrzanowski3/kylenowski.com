// Cloud Functions (2nd gen) entry points, deployed by infra/thanksgiving.tf:
//   tgAuth     public HTTPS: POST /join, /login, /pin   (the sign-in service)
//   tgRefresh  private HTTPS, called by Cloud Scheduler  (the pre-game refresh)

import { http, type Request, type Response } from '@google-cloud/functions-framework';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { AuthError, joinPlayer, loginPlayer, setPin } from './auth';
import { fetchJson } from './espn-fetch';
import { runPregameRefresh } from './refresh';

initializeApp();
const db = getFirestore();
const auth = getAuth();

const ALLOWED_ORIGINS = [
  /^https:\/\/kylenowski\.com$/,
  /^https:\/\/kylenowski-com\.web\.app$/,
  /^https:\/\/kylenowski-com--[a-z0-9-]+\.web\.app$/, // PR preview channels
  /^http:\/\/(localhost|127\.0\.0\.1):\d+$/,
];

function cors(req: Request, res: Response): boolean {
  const origin = req.get('origin');
  if (origin && ALLOWED_ORIGINS.some((re) => re.test(origin))) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Max-Age', '3600');
  }
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return true;
  }
  return false;
}

http('tgAuth', async (req, res) => {
  if (cors(req, res)) return;
  res.set('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST.' });
    return;
  }
  const body = (typeof req.body === 'object' && req.body) || {};
  try {
    const now = Date.now();
    // Route on the last path segment: the cloudfunctions.net URL is /tg-auth/join, and what reaches
    // the function may or may not still carry the /tg-auth prefix.
    switch (`/${req.path.split('/').filter(Boolean).pop() ?? ''}`) {
      case '/join':
        res.json(await joinPlayer(db, auth, body, now));
        return;
      case '/login':
        res.json(await loginPlayer(db, auth, body, now));
        return;
      case '/pin': {
        const idToken = (req.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
        await setPin(db, auth, idToken, body.pin);
        res.json({ ok: true });
        return;
      }
      default:
        res.status(404).json({ error: 'Not found.' });
    }
  } catch (e) {
    if (e instanceof AuthError) {
      if (e.retryAfterSec) res.set('Retry-After', String(e.retryAfterSec));
      res.status(e.status).json({ error: e.message, retryAfterSec: e.retryAfterSec });
      return;
    }
    console.error(e);
    res.status(500).json({ error: 'Something went wrong. Try again.' });
  }
});

http('tgRefresh', async (_req, res) => {
  // Cloud Run IAM allows only the scheduler's service account to call this.
  try {
    const report = await runPregameRefresh(db, fetchJson);
    console.log(JSON.stringify({ message: 'pre-game refresh', ...report }));
    res.json(report);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});
