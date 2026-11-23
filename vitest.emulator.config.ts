import { defineConfig } from 'vitest/config';

// Tests that need the Firestore and Auth emulators. Run with `npm run test:emulator`, which starts
// them (see the "emulators" block in firebase.json). Files share the emulators, so they run one at
// a time.
export default defineConfig({
  test: {
    include: ['tests/emulator/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
