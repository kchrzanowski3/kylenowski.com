// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

// Hosts the browser talks to (CSP connect-src). /thanksgiving: Firestore, Firebase Auth (custom
// tokens + token refresh) and the sign-in Cloud Function.
const connectSrc = [
  "'self'",
  'https://firestore.googleapis.com',
  'https://identitytoolkit.googleapis.com',
  'https://securetoken.googleapis.com',
  'https://us-central1-kylenowski-com.cloudfunctions.net',
];
// Builds for the end-to-end tests talk to the local emulators and sign-in service instead.
if (process.env.PUBLIC_TG_EMULATOR === '1') {
  connectSrc.push('http://127.0.0.1:8080', 'http://127.0.0.1:9099', 'http://127.0.0.1:8090', 'http://127.0.0.1:8091');
}

// Fully static build (dist/), served by Firebase Hosting. Interactive parts are
// React islands that talk to GCP (Firestore etc.) from the browser.
export default defineConfig({
  site: 'https://kylenowski.com',
  // about.astro -> about.html; Firebase Hosting serves it at /about (cleanUrls).
  build: { format: 'file' },
  trailingSlash: 'never',
  integrations: [react()],
  security: {
    // Astro emits a <meta> CSP with hashes for the scripts/styles it bundles.
    csp: {
      directives: [
        "default-src 'self'",
        `connect-src ${connectSrc.join(' ')}`,
        "img-src 'self' data:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ],
    },
  },
});
