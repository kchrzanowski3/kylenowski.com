import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../fixtures/espn/', import.meta.url));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function load(name: string): any {
  return JSON.parse(readFileSync(dir + name, 'utf8'));
}
