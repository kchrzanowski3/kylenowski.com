// Cloud Functions (2nd gen) entry points, deployed by infra/thanksgiving.tf:
//   tgAuth     public HTTPS: POST /join, /login, /pin   (the sign-in service)
//   tgRefresh  private HTTPS, called by Cloud Scheduler  (the pre-game refresh)
//   tgLive     private HTTPS, called by Cloud Scheduler every minute on game day (the live worker)
//   tgAdmin    public HTTPS, admin's ID token required: POST / {action, ...}  (the admin service)
//
// Every function runs the real contest unless the URL has ?contest=test, which runs the test
// contest (docs/thanksgiving-spec.md, "Test contest") on its own tgTest* collections and dates.

import { http, type Request, type Response } from '@google-cloud/functions-framework';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { adminAction, ensureAdminUser, verifyAdmin } from './admin';
import { AuthError, joinPlayer, loginPlayer, setPin } from './auth';
import { fetchJson } from './espn-fetch';
import { runLive } from './live';
import { runPregameRefresh } from './refresh';
import { contestById, type Contest } from '../../src/lib/thanksgiving/config';

initializeApp();
const db = getFirestore();
const auth = getAuth();
const ADMIN_EMAIL = (process.env.TG_ADMIN_EMAIL ?? '').trim().toLowerCase();

const ALLOWED_ORIGINS = [
  /^https:\/\/kylenowski\.com$/,
  /^https:\/\/kylenowski-com\.web\.app$/,
  /^https:\/\/kylenowski-com--[a-z0-9-]+\.web\.app$/, // PR preview channels
  /^http:\/\/(localhost|127\.0\.0\.1):\d+$/,
];

/** The contest a request names (?contest=); the real one if none. Sends a 404 and returns null if unknown. */
function contestOf(req: Request, res: Response): Contest | null {
  const contest = contestById(req.query?.contest);
  if (!contest) res.status(404).json({ error: 'Unknown contest.' });
  return contest;
}

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
  const contest = contestOf(req, res);
  if (!contest) return;
  const body = (typeof req.body === 'object' && req.body) || {};
  try {
    const now = Date.now();
    // Route on the last path segment: the cloudfunctions.net URL is /tg-auth/join, and what reaches
    // the function may or may not still carry the /tg-auth prefix.
    switch (`/${req.path.split('/').filter(Boolean).pop() ?? ''}`) {
      case '/join':
        res.json(await joinPlayer(db, auth, body, now, contest));
        return;
      case '/login':
        res.json(await loginPlayer(db, auth, body, now, contest));
        return;
      case '/pin': {
        const idToken = (req.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
        await setPin(db, auth, idToken, body.pin, contest);
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

function sendError(res: Response, e: unknown) {
  if (e instanceof AuthError) {
    res.status(e.status).json({ error: e.message });
    return;
  }
  console.error(e);
  res.status(500).json({ error: 'Something went wrong. Try again.' });
}

// Created when this function starts (and checked by GET /health after each deploy), before anyone
// could register the admin's address with a password of their own.
let adminReady: Promise<void> | null = null;
const prepareAdmin = () => (adminReady ??= ensureAdminUser(auth, ADMIN_EMAIL).catch((e) => {
  adminReady = null;
  throw e;
}));

http('tgAdmin', async (req, res) => {
  if (cors(req, res)) return;
  res.set('Cache-Control', 'no-store');
  try {
    await prepareAdmin();
    if (req.method === 'GET') {
      res.json({ ok: true });
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Use POST.' });
      return;
    }
    const contest = contestOf(req, res);
    if (!contest) return;
    const idToken = (req.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    const by = await verifyAdmin(auth, idToken, ADMIN_EMAIL);
    const body = (typeof req.body === 'object' && req.body) || {};
    res.json(await adminAction(db, auth, by, body, Date.now(), contest));
  } catch (e) {
    sendError(res, e);
  }
});

http('tgLive', async (req, res) => {
  // Cloud Run IAM allows only the scheduler's service account to call this.
  const contest = contestOf(req, res);
  if (!contest) return;
  try {
    const report = await runLive(db, fetchJson, { holder: randomUUID(), contest });
    if (report.errors.length > 0) console.error(JSON.stringify({ message: 'live worker errors', contest: contest.id, ...report }));
    res.json(report);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});

http('tgRefresh', async (req, res) => {
  // Cloud Run IAM allows only the scheduler's service account to call this.
  const contest = contestOf(req, res);
  if (!contest) return;
  try {
    const report = await runPregameRefresh(db, fetchJson, Date.now, { contest });
    console.log(JSON.stringify({ message: 'pre-game refresh', contest: contest.id, ...report }));
    res.json(report);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});
