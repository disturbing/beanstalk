import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { readCookie, setCookie } from '../src/cookies';
import { isSameOrigin } from '../src/request-context';
import {
  SESSION_SECONDS,
  createSession,
  getSessionUser,
  getWebSession,
  isValidCsrf,
  revokeAllSessions,
  revokeSession,
} from '../src/sessions';
import { T0, signUp, withSession } from './helpers';

const DAY = 24 * 3600 * 1000;

describe('web sessions', () => {
  it('answers null without a cookie, with a forged one, or with an oversized one', async () => {
    expect(await getSessionUser(new Request('https://beanstalk.test/'), env)).toBeNull();
    expect(await getSessionUser(withSession('forged'), env)).toBeNull();
    expect(await getSessionUser(withSession('x'.repeat(500)), env)).toBeNull();
  });

  it('slides the expiry forward on use and ends after 30 idle days', async () => {
    const { user } = await signUp('slide');
    const { secret } = await createSession(env, { userId: user.id, userAgent: null }, T0);
    expect(await getSessionUser(withSession(secret), env, () => T0 + 20 * DAY)).toEqual(user);
    // Used on day 20, so it lives until day 50.
    expect(await getSessionUser(withSession(secret), env, () => T0 + 45 * DAY)).toEqual(user);
    expect(
      await getSessionUser(
        withSession(secret),
        env,
        () => T0 + 45 * DAY + SESSION_SECONDS * 1000 + 1,
      ),
    ).toBeNull();
  });

  it('signs out one browser, then every browser', async () => {
    const { user } = await signUp('everywhere');
    const a = await createSession(env, { userId: user.id, userAgent: null }, T0);
    const b = await createSession(env, { userId: user.id, userAgent: null }, T0);
    const sessionA = await getWebSession(`__Host-bs_session=${a.secret}`, env, () => T0);
    if (sessionA === null) throw new Error('session A should be live');
    await revokeSession(env, sessionA.sessionHash, T0);
    expect(await getSessionUser(withSession(a.secret), env, () => T0)).toBeNull();
    expect(await getSessionUser(withSession(b.secret), env, () => T0)).toEqual(user);
    expect(await revokeAllSessions(env, user.id, T0)).toBeGreaterThanOrEqual(2);
    expect(await getSessionUser(withSession(b.secret), env, () => T0)).toBeNull();
  });

  it('binds CSRF tokens to the session', async () => {
    const { user } = await signUp('csrf');
    const a = await createSession(env, { userId: user.id, userAgent: null }, T0);
    const b = await createSession(env, { userId: user.id, userAgent: null }, T0);
    const sessionA = await getWebSession(`__Host-bs_session=${a.secret}`, env, () => T0);
    const sessionB = await getWebSession(`__Host-bs_session=${b.secret}`, env, () => T0);
    if (sessionA === null || sessionB === null) throw new Error('sessions should be live');
    expect(await isValidCsrf(sessionA, sessionA.csrfToken)).toBe(true);
    expect(await isValidCsrf(sessionA, sessionB.csrfToken)).toBe(false);
    expect(await isValidCsrf(sessionA, '')).toBe(false);
    expect(await isValidCsrf(sessionA, undefined)).toBe(false);
  });
});

describe('cookies', () => {
  it('sets host-only, secure, HttpOnly, Lax cookies and reads them back', () => {
    const header = setCookie('__Host-bs_session', 'abc', 60);
    expect(header).toBe(
      '__Host-bs_session=abc; Path=/; Max-Age=60; HttpOnly; Secure; SameSite=Lax',
    );
    expect(readCookie('a=1; __Host-bs_session=abc; b=2', '__Host-bs_session')).toBe('abc');
    expect(readCookie('x__Host-bs_session=abc', '__Host-bs_session')).toBeNull();
  });
});

describe('same-origin checks', () => {
  const post = (headers: Record<string, string>) =>
    new Request('https://beanstalk.test/auth/signout', { method: 'POST', headers });

  it('accepts this origin, or a withheld origin the browser marks same-origin', () => {
    expect(isSameOrigin(post({ origin: 'https://beanstalk.test' }))).toBe(true);
    expect(isSameOrigin(post({ origin: 'null', 'sec-fetch-site': 'same-origin' }))).toBe(true);
  });

  it('refuses another origin, a spoofed fetch-site beside it, and no signal at all', () => {
    expect(isSameOrigin(post({ origin: 'https://evil.test' }))).toBe(false);
    expect(
      isSameOrigin(post({ origin: 'https://evil.test', 'sec-fetch-site': 'same-origin' })),
    ).toBe(false);
    expect(isSameOrigin(post({ origin: 'null', 'sec-fetch-site': 'cross-site' }))).toBe(false);
    expect(isSameOrigin(post({}))).toBe(false);
  });
});
