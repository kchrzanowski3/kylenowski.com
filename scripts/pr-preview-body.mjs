// Puts the Firebase Hosting preview link at the top of a PR description, with one-click links to
// the pages the PR changes, replacing what an earlier CI run added (.github/workflows/deploy.yml,
// hosting job). Tests: tests/unit/pr-preview-body.test.ts.
//
//   BODY=... URL=https://... SHA=abc1234... DIST=dist LIVE=https://kylenowski.com \
//     node scripts/pr-preview-body.mjs        # prints the new body
//
// A page counts as changed when its built HTML differs from the live site's (or the live site
// doesn't have it). Astro names scripts and styles by content hash, so a change to a component,
// style or layout changes the HTML of every page that uses it.

import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

export const START = '<!-- preview-link:start -->';
export const END = '<!-- preview-link:end -->';

/** dist/thanksgiving.html → /thanksgiving, dist/index.html → /, dist/a/index.html → /a. Null for non-pages. */
export function pageRoute(relPath) {
  const p = relPath.split(sep).join('/');
  if (!p.endsWith('.html') || p === '404.html' || p.startsWith('_astro/') || p.startsWith('__/')) return null;
  const route = '/' + p.replace(/\.html$/, '').replace(/(^|\/)index$/, '');
  return route === '/' ? '/' : route.replace(/\/$/, '');
}

async function htmlFiles(dir, root = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await htmlFiles(full, root)));
    else if (entry.name.endsWith('.html')) out.push(relative(root, full));
  }
  return out;
}

/** Routes whose built HTML differs from the live site. `fetchText` returns null for a missing page. */
export async function changedPages(distDir, liveOrigin, fetchText) {
  const changed = [];
  for (const rel of (await htmlFiles(distDir)).sort()) {
    const route = pageRoute(rel);
    if (route === null) continue;
    const built = await readFile(join(distDir, rel), 'utf8');
    let live;
    try {
      live = await fetchText(liveOrigin + route);
    } catch {
      live = undefined; // couldn't tell: list it, better one link too many than one missing
    }
    if (live !== built) changed.push(route);
  }
  return changed;
}

/**
 * Removes an earlier preview block and puts a fresh one first. A block is only removed when its
 * start and end markers are each on a line of their own, with the start before the end; marker text
 * mentioned anywhere else (say, in a sentence about this script) is left alone.
 */
export function withPreviewLink(body, url, sha, pages = []) {
  const lines = (body ?? '').replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((l) => l.trim() === START);
  const end = start < 0 ? -1 : lines.findIndex((l, i) => i > start && l.trim() === END);
  const rest = start >= 0 && end > start ? [...lines.slice(0, start), ...lines.slice(end + 1)] : lines;
  while (rest.length > 0 && rest[0].trim() === '') rest.shift();

  const base = url.replace(/\/$/, '');
  const label = base.replace(/^https?:\/\//, '');
  const block = [START, `**Preview:** [${label}](${base}) (built from ${sha.slice(0, 7)}; expires 7 days after the last push)`];
  block.push(
    pages.length > 0
      ? `**Changed pages:** ${pages.map((p) => `[${p}](${base}${p === '/' ? '/' : p})`).join(' · ')}`
      : '**Changed pages:** none (no page differs from the live site)',
  );
  block.push(END);
  return [...block, '', ...rest].join('\n').replace(/\n*$/, '\n');
}

async function fetchLive(url) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { BODY, URL, SHA, DIST = 'dist', LIVE = 'https://kylenowski.com' } = process.env;
  if (!URL || !SHA) {
    console.error('URL and SHA are required');
    process.exit(1);
  }
  const pages = await changedPages(DIST, LIVE, fetchLive);
  process.stdout.write(withPreviewLink(BODY ?? '', URL, SHA, pages));
}
