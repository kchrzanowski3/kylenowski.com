// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

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
        "img-src 'self' data:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ],
    },
  },
});
