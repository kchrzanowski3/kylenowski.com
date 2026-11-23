// Fetching ESPN's feeds, with a timeout and a couple of retries (the feeds are unofficial).

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function fetchJson(url: string): Promise<any> {
  // The core API hands out http:// $refs; always fetch over https.
  const target = url.replace(/^http:\/\//, 'https://');
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(target, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${target}`);
      return await res.json();
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw lastError;
}
