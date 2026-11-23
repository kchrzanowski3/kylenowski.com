import { defineConfig } from 'vitest/config';

// Unit tests only. The emulator tests (tests/emulator) run through `npm run test:emulator`, which
// starts the Firestore and Auth emulators first; the Playwright tests (tests/e2e) through
// `npm run test:e2e`.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
  },
});
