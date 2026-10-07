import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { listAudit } from '../src/audit';
import {
  finishAddPasskey,
  finishPasskeySignin,
  finishPasskeySignup,
  listPasskeys,
  removePasskey,
  startAddPasskey,
  startPasskeySignin,
  startPasskeySignup,
} from '../src/passkeys';
import { getSessionUser } from '../src/sessions';
import { createVirtualAuthenticator } from '../src/testing/virtual-authenticator';
import { RP, T0, context, signUp, withSession } from './helpers';

describe('passkey sign-up', () => {
  it('creates the person, stores the passkey and opens a session', async () => {
    const { user, session } = await signUp('ada');
    expect(user).toMatchObject({ handle: 'ada', email: null });
    expect(user.id).toMatch(/^u_[a-z2-7]{16}$/);
    expect(await getSessionUser(withSession(session.secret), env, () => T0)).toEqual(user);
    expect(await listPasskeys(env, user.id)).toEqual([
      expect.objectContaining({ name: 'Passkey on Mac', createdAt: T0 }),
    ]);
    expect((await listAudit(env, user.id)).map((event) => event.action)).toEqual(['user.signup']);
  });

  it('refuses a handle that is already taken, in any case', async () => {
    await signUp('grace');
    expect(await startPasskeySignup(env, { handle: 'grace', rp: RP, now: T0 })).toEqual({
      ok: false,
      reason: 'handle_taken',
    });
  });

  it('refuses a second sign-up that raced for the same handle', async () => {
    const [first, second] = await Promise.all([
      createVirtualAuthenticator(),
      createVirtualAuthenticator(),
    ]);
    const startA = await startPasskeySignup(env, { handle: 'race', rp: RP, now: T0 });
    const startB = await startPasskeySignup(env, { handle: 'race', rp: RP, now: T0 });
    if (!('options' in startA) || !('options' in startB)) throw new Error('both should start');
    const a = await finishPasskeySignup(env, {
      handle: startA.handle,
      response: await first.register(startA.options, RP.origin),
      context: context(),
    });
    const b = await finishPasskeySignup(env, {
      handle: startB.handle,
      response: await second.register(startB.options, RP.origin),
      context: context(),
    });
    expect(a.ok).toBe(true);
    expect(b).toEqual({ ok: false, reason: 'handle_taken' });
  });

  it('refuses a response made for another origin', async () => {
    const authenticator = await createVirtualAuthenticator();
    const started = await startPasskeySignup(env, { handle: 'mallory', rp: RP, now: T0 });
    if (!('options' in started)) throw new Error('should start');
    const response = await authenticator.register(started.options, 'https://evil.test');
    expect(
      await finishPasskeySignup(env, { handle: started.handle, response, context: context() }),
    ).toEqual({
      ok: false,
      reason: 'not_verified',
    });
  });

  it('lets a challenge expire after five minutes', async () => {
    const authenticator = await createVirtualAuthenticator();
    const started = await startPasskeySignup(env, { handle: 'late', rp: RP, now: T0 });
    if (!('options' in started)) throw new Error('should start');
    const response = await authenticator.register(started.options, RP.origin);
    const late = await finishPasskeySignup(env, {
      handle: started.handle,
      response,
      context: context(T0 + 300_000),
    });
    expect(late).toEqual({ ok: false, reason: 'expired' });
  });

  it('uses each challenge once', async () => {
    const authenticator = await createVirtualAuthenticator();
    const started = await startPasskeySignup(env, { handle: 'once', rp: RP, now: T0 });
    if (!('options' in started)) throw new Error('should start');
    const response = await authenticator.register(started.options, RP.origin);
    const first = await finishPasskeySignup(env, {
      handle: started.handle,
      response,
      context: context(),
    });
    expect(first.ok).toBe(true);
    const again = await finishPasskeySignup(env, {
      handle: started.handle,
      response,
      context: context(),
    });
    expect(again).toEqual({ ok: false, reason: 'expired' });
  });
});

describe('passkey sign-in', () => {
  it('signs a returning person in with the passkey they signed up with', async () => {
    const { user, authenticator } = await signUp('linus');
    const started = await startPasskeySignin(env, { rp: RP, now: T0 });
    const response = await authenticator.authenticate(started.options, RP.origin);
    const signedIn = await finishPasskeySignin(env, {
      handle: started.handle,
      response,
      context: context(T0 + 1000),
    });
    if (!signedIn.ok) throw new Error(signedIn.reason);
    expect(signedIn.user).toEqual(user);
    expect(
      await getSessionUser(withSession(signedIn.session.secret), env, () => T0 + 2000),
    ).toEqual(user);
    const [passkey] = await listPasskeys(env, user.id);
    expect(passkey?.lastUsedAt).toBe(T0 + 1000);
  });

  it('refuses a passkey this site never registered', async () => {
    const stranger = await createVirtualAuthenticator();
    const started = await startPasskeySignin(env, { rp: RP, now: T0 });
    const response = await stranger.authenticate(started.options, RP.origin);
    expect(
      await finishPasskeySignin(env, { handle: started.handle, response, context: context() }),
    ).toEqual({
      ok: false,
      reason: 'unknown_passkey',
    });
  });

  it('refuses an assertion signed for another challenge', async () => {
    const { authenticator } = await signUp('ken');
    const first = await startPasskeySignin(env, { rp: RP, now: T0 });
    const second = await startPasskeySignin(env, { rp: RP, now: T0 });
    const response = await authenticator.authenticate(first.options, RP.origin);
    expect(
      await finishPasskeySignin(env, { handle: second.handle, response, context: context() }),
    ).toEqual({
      ok: false,
      reason: 'not_verified',
    });
  });
});

describe('managing passkeys', () => {
  it('adds a second passkey and removes one, but never the last', async () => {
    const { user } = await signUp('barbara');
    const phone = await createVirtualAuthenticator();
    const started = await startAddPasskey(env, { user, rp: RP, now: T0 });
    const added = await finishAddPasskey(env, {
      user,
      handle: started.handle,
      response: await phone.register(started.options, RP.origin),
      context: context(),
    });
    expect(added).toEqual({ ok: true });
    const passkeys = await listPasskeys(env, user.id);
    expect(passkeys).toHaveLength(2);
    const first = passkeys[0]?.id ?? '';
    const second = passkeys[1]?.id ?? '';
    expect(await removePasskey(env, { user, passkeyId: first, ip: null, now: T0 })).toBe('removed');
    expect(await removePasskey(env, { user, passkeyId: second, ip: null, now: T0 })).toBe(
      'last_sign_in_method',
    );
    expect(await removePasskey(env, { user, passkeyId: 'nope', ip: null, now: T0 })).toBe(
      'not_found',
    );
  });

  it('will not finish another person’s add-passkey ceremony', async () => {
    const { user: alice } = await signUp('alice');
    const { user: bob } = await signUp('bob');
    const key = await createVirtualAuthenticator();
    const started = await startAddPasskey(env, { user: alice, rp: RP, now: T0 });
    const response = await key.register(started.options, RP.origin);
    expect(
      await finishAddPasskey(env, {
        user: bob,
        handle: started.handle,
        response,
        context: context(),
      }),
    ).toEqual({
      ok: false,
      reason: 'expired',
    });
  });
});
