import { describe, expect, it } from 'vitest';

import { readSecrets } from './config';

const LONG = 'x'.repeat(32);

describe('readSecrets', () => {
  it('accepts secrets of at least 32 characters', () => {
    expect(readSecrets({ ADMIN_TOKEN: LONG, RUN_TOKEN_SECRET: LONG })).toEqual({
      adminToken: LONG,
      tokenSecret: LONG,
    });
  });

  it('names the weak secret without echoing its value', () => {
    const weak = { ADMIN_TOKEN: LONG, RUN_TOKEN_SECRET: 'short-value' };

    expect(() => readSecrets(weak)).toThrow(/RUN_TOKEN_SECRET must be at least 32 characters/);
    expect(() => readSecrets(weak)).not.toThrow(/short-value/);
  });

  it('rejects an empty secret', () => {
    expect(() => readSecrets({ ADMIN_TOKEN: '', RUN_TOKEN_SECRET: LONG })).toThrow(/ADMIN_TOKEN/);
  });
});
