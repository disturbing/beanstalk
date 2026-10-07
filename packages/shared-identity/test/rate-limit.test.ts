import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { isWithinLimits } from '../src/rate-limit';
import { Handle } from '../src/users';

describe('sign-in rate limits', () => {
  it('refuses the eleventh attempt in a minute from one IP (the real binding)', async () => {
    const results: boolean[] = [];
    for (let attempt = 0; attempt < 11; attempt += 1)
      // oxlint-disable-next-line no-await-in-loop -- attempts are counted in order
      results.push(await isWithinLimits(env.SIGNIN_RATE_LIMIT, ['ip:192.0.2.9']));
    expect(results.slice(0, 10).every(Boolean)).toBe(true);
    expect(results[10]).toBe(false);
    expect(await isWithinLimits(env.SIGNIN_RATE_LIMIT, ['ip:192.0.2.10'])).toBe(true);
  });

  it('fails when any one key is over its limit', async () => {
    const limiter = { limit: async ({ key }: { key: string }) => ({ success: key.length < 0 }) };
    expect(await isWithinLimits(limiter, ['a'])).toBe(false);
  });
});

describe('handles', () => {
  it('accepts lowercase names with single hyphens and refuses the rest', () => {
    expect(Handle.parse(' Coop ')).toBe('coop');
    expect(Handle.safeParse('bean-stalk-1').success).toBe(true);
    for (const bad of [
      'a',
      '-lead',
      'trail-',
      'two--hyphens',
      'under_score',
      'admin',
      'x'.repeat(40),
    ])
      expect(Handle.safeParse(bad).success, bad).toBe(false);
  });
});
