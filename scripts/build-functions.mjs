// Bundles functions/src (and the shared code in src/lib) into functions/dist, next to the
// functions' package.json and lockfile. Terraform zips functions/dist and Cloud Build installs the
// two runtime dependencies from the lockfile. The output is deterministic, so an unchanged source
// gives an unchanged zip and no redeploy.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = `${root}functions/dist`;

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [`${root}functions/src/index.ts`],
  outfile: `${out}/index.js`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['firebase-admin', 'firebase-admin/*', '@google-cloud/functions-framework'],
  legalComments: 'none',
  logLevel: 'warning',
});

for (const f of ['package.json', 'package-lock.json']) copyFileSync(`${root}functions/${f}`, `${out}/${f}`);
console.log('built functions/dist');
