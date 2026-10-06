import { describe, expect, it } from 'vitest';

import { RunId, TaskId } from '@beanstalk/shared-race/ids';

import { isSameSecret, presentedToken } from './credentials';
import { issueToken, verifyToken } from './tokens';

const SECRET = 'a-test-secret';
const NOW = Date.UTC(2026, 9, 3, 12, 0, 0);
const run = RunId.parse('abcdef1234');

describe('run tokens', () => {
  it('signs a contributor capability for a stable bean and rejects edited ownership', async () => {
    const bean = TaskId.parse('t001');
    const issued = await issueToken(
      SECRET,
      { run, bean, sub: 'checkout', scope: 'contributor' },
      { ttlSeconds: 60, nowMs: NOW },
    );
    const verified = await verifyToken(SECRET, issued.token, NOW);
    expect(verified).toMatchObject({
      ok: true,
      claims: { run, bean, sub: 'checkout', scope: 'contributor' },
    });
    expect(await verifyToken(SECRET, issued.token, NOW + 60_000)).toEqual({
      ok: false,
      failure: 'expired',
    });
    const [prefix, , signature] = issued.token.split('.');
    if (!verified.ok) throw new Error('invalid issued token');
    const changed = { ...verified.claims, bean: 't002' };
    const forged = btoa(JSON.stringify(changed))
      .replace(/=+$/, '')
      .replaceAll('+', '-')
      .replaceAll('/', '_');
    expect(await verifyToken(SECRET, `${prefix}.${forged}.${signature}`, NOW)).toEqual({
      ok: false,
      failure: 'bad_signature',
    });
  });

  it('requires an owning bean only for contributor capabilities', async () => {
    await expect(
      issueToken(
        SECRET,
        { run, sub: 'checkout', scope: 'contributor' },
        { ttlSeconds: 60, nowMs: NOW },
      ),
    ).rejects.toThrow();
    await expect(
      issueToken(
        SECRET,
        { run, bean: TaskId.parse('t001'), sub: 'reader', scope: 'view' },
        { ttlSeconds: 60, nowMs: NOW },
      ),
    ).rejects.toThrow();
  });
  it('verifies a token it issued and returns its claims', async () => {
    const issued = await issueToken(
      SECRET,
      { run, sub: 'a3', scope: 'slot' },
      { ttlSeconds: 600, nowMs: NOW },
    );

    const check = await verifyToken(SECRET, issued.token, NOW + 1000);

    expect(check).toEqual({
      ok: true,
      claims: { run, sub: 'a3', scope: 'slot', exp: NOW / 1000 + 600 },
    });
    expect(issued.expiresAt).toBe('2026-10-03T12:10:00.000Z');
  });

  it('rejects an expired token', async () => {
    const issued = await issueToken(
      SECRET,
      { run, sub: 'a0', scope: 'slot' },
      { ttlSeconds: 60, nowMs: NOW },
    );

    expect(await verifyToken(SECRET, issued.token, NOW + 61_000)).toEqual({
      ok: false,
      failure: 'expired',
    });
  });

  it('rejects a token signed with another secret', async () => {
    const issued = await issueToken(
      'other',
      { run, sub: 'a0', scope: 'slot' },
      { ttlSeconds: 60, nowMs: NOW },
    );

    expect(await verifyToken(SECRET, issued.token, NOW)).toEqual({
      ok: false,
      failure: 'bad_signature',
    });
  });

  it('rejects a token whose claims were edited', async () => {
    const issued = await issueToken(
      SECRET,
      { run, sub: 'a0', scope: 'view' },
      { ttlSeconds: 60, nowMs: NOW },
    );
    const [prefix, , signature] = issued.token.split('.');
    const forged = btoa(
      JSON.stringify({ run, sub: 'a0', scope: 'slot', exp: NOW / 1000 + 60 }),
    ).replace(/=+$/, '');

    expect(await verifyToken(SECRET, `${prefix}.${forged}.${signature}`, NOW)).toEqual({
      ok: false,
      failure: 'bad_signature',
    });
  });

  it('rejects garbage', async () => {
    const checks = await Promise.all(
      ['', 'bst1', 'bst1.x.y', 'nope.a.b', 'bst1.%%%.abc'].map((token) =>
        verifyToken(SECRET, token, NOW),
      ),
    );

    expect(checks.map((check) => check.ok)).toEqual([false, false, false, false, false]);
  });
});

describe('credentials', () => {
  it('reads a bearer token and a Basic password, ignoring the user name', () => {
    const bearer = new Request('https://x.test', { headers: { authorization: 'Bearer t0k' } });
    const basic = new Request('https://x.test', {
      headers: { authorization: `Basic ${btoa('x:t0k')}` },
    });
    const none = new Request('https://x.test');

    expect(presentedToken(bearer)).toBe('t0k');
    expect(presentedToken(basic)).toBe('t0k');
    expect(presentedToken(none)).toBeNull();
  });

  it('compares secrets without leaking their length', async () => {
    expect(await isSameSecret('admin', 'admin')).toBe(true);
    expect(await isSameSecret('admin', 'admin2')).toBe(false);
    expect(await isSameSecret('', '')).toBe(false);
  });
});
