import { describe, expect, it } from 'vitest';

import { RELOAD_FLAG, isChunkLoadError, shouldReloadFor } from './chunk-reload';

/** sessionStorage as a map. */
function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

const CHROME = new TypeError(
  'Failed to fetch dynamically imported module: https://gitstalk.io/assets/page-3f2a.js',
);

describe('a failed chunk load', () => {
  it.each([
    CHROME,
    new TypeError('error loading dynamically imported module'),
    new TypeError('Importing a module script failed.'),
    new Error('Unable to preload CSS for /assets/page-3f2a.css'),
    'Loading chunk 412 failed.',
  ])('is recognized: %s', (reason) => {
    expect(isChunkLoadError(reason)).toBe(true);
  });

  it.each([new Error('Cannot read properties of null'), null, 42, { message: 7 }])(
    'is not any other error: %s',
    (reason) => {
      expect(isChunkLoadError(reason)).toBe(false);
    },
  );
});

describe('reloading for a missing chunk', () => {
  it('reloads once, then not again within a few minutes (no loop)', () => {
    const storage = memoryStorage();
    expect(shouldReloadFor(CHROME, storage, 1_000)).toBe(true);
    expect(storage.values.get(RELOAD_FLAG)).toBe('1000');
    expect(shouldReloadFor(CHROME, storage, 60_000)).toBe(false);
  });

  it('reloads again after a later deploy', () => {
    const storage = memoryStorage();
    expect(shouldReloadFor(CHROME, storage, 0)).toBe(true);
    expect(shouldReloadFor(CHROME, storage, 10 * 60 * 1000)).toBe(true);
  });

  it('never reloads for other errors, or when storage is off', () => {
    const storage = memoryStorage();
    expect(shouldReloadFor(new Error('boom'), storage, 0)).toBe(false);
    const off = {
      getItem: () => {
        throw new Error('storage disabled');
      },
      setItem: () => undefined,
    };
    expect(shouldReloadFor(CHROME, off, 0)).toBe(false);
  });
});
