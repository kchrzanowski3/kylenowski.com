// Read-only runtime security assertions against a deployed site (PR preview channel or production).
// Run by CI after preview deploys (preview-security job) and after production deploys (smoke job).
//
//   SMOKE_URL=https://kylenowski.com npm run test:security-smoke
import { expect, test } from '@playwright/test';

const FUNCTIONS_BASE = process.env.SMOKE_FUNCTIONS_BASE ?? 'https://us-central1-kylenowski-com.cloudfunctions.net';
const SIGN_IN_API = process.env.SMOKE_API ?? `${FUNCTIONS_BASE}/tg-auth`;
const ADMIN_API = process.env.SMOKE_ADMIN_API ?? `${FUNCTIONS_BASE}/tg-admin`;
const LIVE_API = process.env.SMOKE_LIVE_API ?? `${FUNCTIONS_BASE}/tg-live`;
const REFRESH_API = process.env.SMOKE_REFRESH_API ?? `${FUNCTIONS_BASE}/tg-refresh`;

const UNTRUSTED_ORIGIN = 'https://evil.example';

test.describe('HTTP security headers and CSP', () => {
  for (const path of ['/', '/thanksgiving', '/thanksgiving/admin']) {
    test(`${path} serves required Firebase Hosting security headers`, async ({ request }) => {
      const res = await request.get(path);
      expect(res.status()).toBe(200);
      const headers = res.headers();

      const hsts = headers['strict-transport-security'] ?? '';
      const maxAge = Number(hsts.match(/max-age=(\d+)/)?.[1] ?? 0);
      expect(maxAge).toBeGreaterThanOrEqual(31536000);
      expect(hsts).toContain('includeSubDomains');
      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(headers['permissions-policy']).toContain('camera=()');
      expect(headers['permissions-policy']).toContain('microphone=()');
      expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    });

    test(`${path} includes Astro hash-based CSP meta tag without unsafe script directives`, async ({ request }) => {
      const res = await request.get(path);
      expect(res.status()).toBe(200);
      const html = await res.text();
      const match = html.match(/<meta[^>]+http-equiv="content-security-policy"[^>]+content="([^"]+)"/i);
      expect(match?.[1]).toBeTruthy();
      const csp = match![1];

      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("base-uri 'self'");
      expect(csp).toContain("form-action 'self'");

      const scriptDirective = csp
        .split(';')
        .map((d) => d.trim())
        .find((d) => d.startsWith('script-src'));
      if (scriptDirective) {
        expect(scriptDirective).not.toContain("'unsafe-eval'");
        expect(scriptDirective).not.toContain("'unsafe-inline'");
      }
    });
  }

  test('app pages set noindex and do not expose internal placeholders', async ({ request }) => {
    for (const path of ['/thanksgiving', '/thanksgiving/admin']) {
      const res = await request.get(path);
      expect(res.status()).toBe(200);
      const html = await res.text();
      expect(html).toMatch(/<meta[^>]+name="robots"[^>]+noindex/i);
      expect(html).not.toContain('__ADMIN_EMAIL__');
    }
  });
});

test.describe('CORS enforcement on public Cloud Functions', () => {
  for (const [name, url] of [
    ['tg-auth', `${SIGN_IN_API}/login`],
    ['tg-admin', ADMIN_API],
  ] as const) {
    test(`${name} allows the site origin and rejects untrusted origins`, async ({ request, baseURL }) => {
      const origin = new URL(baseURL!).origin;

      const allowed = await request.fetch(url, {
        method: 'OPTIONS',
        headers: { origin, 'access-control-request-method': 'POST' },
      });
      expect(allowed.status()).toBe(204);
      expect(allowed.headers()['access-control-allow-origin']).toBe(origin);
      expect(allowed.headers()['vary']).toMatch(/origin/i);

      const denied = await request.fetch(url, {
        method: 'OPTIONS',
        headers: { origin: UNTRUSTED_ORIGIN, 'access-control-request-method': 'POST' },
      });
      expect(denied.headers()['access-control-allow-origin']).toBeUndefined();
    });
  }
});

test.describe('Cloud Function authentication and access controls', () => {
  test('tg-admin rejects missing, malformed, and forged Bearer tokens', async ({ request }) => {
    const b64url = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const forgedJwt = `${b64url({ alg: 'none' })}.${b64url({ email: 'admin@example.com', email_verified: true })}.`;

    for (const authHeader of [undefined, 'Bearer ', 'Bearer not-a-jwt', `Bearer ${forgedJwt}`]) {
      const headers: Record<string, string> = {};
      if (authHeader !== undefined) headers.authorization = authHeader;

      const res = await request.post(ADMIN_API, {
        headers,
        data: { action: 'rescore' },
      });
      expect(res.status()).toBe(401);
      expect(res.headers()['cache-control']).toBe('no-store');
    }
  });

  test('tg-auth enforces POST-only and rejects unauthenticated /pin updates', async ({ request }) => {
    const getRes = await request.get(`${SIGN_IN_API}/login`);
    expect(getRes.status()).toBe(405);
    expect(getRes.headers()['cache-control']).toBe('no-store');

    const pinRes = await request.post(`${SIGN_IN_API}/pin`, {
      data: { pin: '1234' },
    });
    expect(pinRes.status()).toBe(401);
  });

  test('private scheduler-only functions (tg-live, tg-refresh) reject unauthenticated callers', async ({ request }) => {
    for (const url of [LIVE_API, REFRESH_API]) {
      const res = await request.post(url);
      expect([401, 403]).toContain(res.status());
    }
  });
});
