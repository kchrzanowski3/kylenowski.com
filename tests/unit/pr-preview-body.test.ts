// The preview link and changed-page links that CI puts at the top of a PR description
// (scripts/pr-preview-body.mjs).
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module without type declarations
import { END, START, changedPages, pageRoute, withPreviewLink } from '../../scripts/pr-preview-body.mjs';

const URL = 'https://kylenowski-com--pr-5-tkojat3u.web.app';
const link = (sha: string) =>
  `**Preview:** [kylenowski-com--pr-5-tkojat3u.web.app](${URL}) (built from ${sha}; expires 7 days after the last push)`;
const NONE = '**Changed pages:** none (no page differs from the live site)';

describe('withPreviewLink', () => {
  it('puts a clickable Markdown link first and keeps the description', () => {
    expect(withPreviewLink('## Summary\nDoes a thing.', URL, '1111111abcdef')).toBe(
      `${START}\n${link('1111111')}\n${NONE}\n${END}\n\n## Summary\nDoes a thing.\n`,
    );
  });

  it('links each changed page, one click each', () => {
    const out = withPreviewLink('## Summary', URL, '1111111abcdef', ['/', '/thanksgiving']);
    expect(out).toContain(`**Changed pages:** [/](${URL}/) · [/thanksgiving](${URL}/thanksgiving)`);
  });

  it('replaces the earlier block instead of adding another', () => {
    const once = withPreviewLink('## Summary\nDoes a thing.', URL, '1111111abcdef', ['/thanksgiving']);
    const twice = withPreviewLink(once, URL, '2222222abcdef');
    expect(twice).toBe(`${START}\n${link('2222222')}\n${NONE}\n${END}\n\n## Summary\nDoes a thing.\n`);
    expect(twice.split(START)).toHaveLength(2);
  });

  // The bug that cut off PR 5's description: marker text mentioned inside a sentence was taken
  // as the start of a block, and everything after it was deleted.
  it('keeps text that mentions the markers in a sentence', () => {
    const body = `## Summary\n- The line sits between \`${START}\` / \`${END}\` markers.\n\n## Testing\nThis PR tests itself.`;
    const out = withPreviewLink(body, URL, '1111111abcdef');
    expect(out).toContain('## Testing\nThis PR tests itself.');
    const again = withPreviewLink(out, URL, '2222222abcdef');
    expect(again).toContain('## Testing\nThis PR tests itself.');
    expect(again).toContain(`- The line sits between \`${START}\``);
  });

  it('handles descriptions edited on github.com (CRLF line endings)', () => {
    const once = withPreviewLink('## Summary\nDoes a thing.', URL, '1111111abcdef').replace(/\n/g, '\r\n');
    expect(withPreviewLink(once, URL, '2222222abcdef')).toBe(
      `${START}\n${link('2222222')}\n${NONE}\n${END}\n\n## Summary\nDoes a thing.\n`,
    );
  });

  it("doesn't delete anything when a start marker has no end marker", () => {
    const body = `${START}\n**Preview:** old\n\n## Summary\nDoes a thing.`;
    expect(withPreviewLink(body, URL, '1111111abcdef')).toContain('## Summary\nDoes a thing.');
  });

  it('works on an empty description', () => {
    expect(withPreviewLink('', URL, '1111111abcdef')).toBe(`${START}\n${link('1111111')}\n${NONE}\n${END}\n`);
  });
});

describe('pageRoute', () => {
  it('maps built files to clean URLs', () => {
    expect(pageRoute('index.html')).toBe('/');
    expect(pageRoute('thanksgiving.html')).toBe('/thanksgiving');
    expect(pageRoute(join('thanksgiving', 'admin.html'))).toBe('/thanksgiving/admin');
    expect(pageRoute(join('blog', 'index.html'))).toBe('/blog');
  });

  it('skips the 404 page and non-pages', () => {
    expect(pageRoute('404.html')).toBeNull();
    expect(pageRoute('favicon.svg')).toBeNull();
    expect(pageRoute(join('_astro', 'x.html'))).toBeNull();
  });
});

describe('changedPages', () => {
  const dist = mkdtempSync(join(tmpdir(), 'dist-'));
  writeFileSync(join(dist, 'index.html'), '<h1>home</h1>');
  writeFileSync(join(dist, 'thanksgiving.html'), '<h1>picks v2</h1>');
  writeFileSync(join(dist, '404.html'), '<h1>nope</h1>');
  mkdirSync(join(dist, 'thanksgiving'));
  writeFileSync(join(dist, 'thanksgiving', 'admin.html'), '<h1>admin</h1>');
  const live: Record<string, string> = {
    'https://kylenowski.com/': '<h1>home</h1>',
    'https://kylenowski.com/thanksgiving': '<h1>picks v1</h1>',
  };
  const fetchText = async (u: string) => live[u] ?? null;

  it('lists pages whose HTML differs from the live site, and new pages', async () => {
    expect(await changedPages(dist, 'https://kylenowski.com', fetchText)).toEqual(['/thanksgiving', '/thanksgiving/admin']);
  });

  it('lists a page it could not check, rather than leave it out', async () => {
    const failing = async (u: string) => {
      if (u.endsWith('/')) throw new Error('HTTP 503');
      return live[u] ?? null;
    };
    expect(await changedPages(dist, 'https://kylenowski.com', failing)).toContain('/');
  });
});
