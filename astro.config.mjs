// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

// Fully static build (dist/). Interactive parts are React islands that call
// backend APIs; nothing is server-rendered.
export default defineConfig({
  site: 'https://kylenowski.com',
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
