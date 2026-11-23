import { defineConfig, devices } from '@playwright/test';

// End-to-end tests for /thanksgiving (docs/thanksgiving-spec.md, Testing §6), all local:
//   - Firestore + Auth emulators (ports from firebase.json)
//   - the sign-in Cloud Function, run with the Functions Framework on :8090
//   - the site, built to talk to those (PUBLIC_TG_EMULATOR=1), served from dist/ by the Hosting
//     emulator on :5050 (so firebase.json's headers and clean URLs apply too)
const PROJECT = 'demo-kylenowski';
const emulatorEnv = {
  GCLOUD_PROJECT: PROJECT,
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
};
Object.assign(process.env, emulatorEnv); // for the tests' own firebase-admin seeding

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5050',
    trace: 'off',
  },
  projects: [{ name: 'phone', use: { ...devices['Pixel 7'] } }],
  // `npm run test:e2e` builds the site and the function first; the servers are started directly
  // with node (no npm/npx wrapper) so Playwright can stop them cleanly afterwards.
  webServer: [
    {
      command: `node node_modules/firebase-tools/lib/bin/firebase.js emulators:start --only firestore,auth,hosting --project ${PROJECT}`,
      url: 'http://127.0.0.1:5050/thanksgiving',
      timeout: 120_000,
      reuseExistingServer: false,
      gracefulShutdown: { signal: 'SIGINT', timeout: 15_000 }, // lets the CLI stop the Java emulator
    },
    {
      command: 'node node_modules/@google-cloud/functions-framework/build/src/main.js --source=functions/dist --target=tgAuth --port=8090',
      port: 8090, // it answers GET / with 404 (only POST /join etc. exist), so wait for the port
      env: emulatorEnv,
      timeout: 60_000,
      reuseExistingServer: false,
    },
  ],
});
