import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import type { EmailSender } from '../src/magic-links';
import { consumeMagicLink, emailSignInConfig, requestMagicLink } from '../src/magic-links';
import { getSessionUser } from '../src/sessions';
import { T0, withSession } from './helpers';

type Sent = { readonly to: unknown; readonly subject: string; readonly text: string };

/** A fake Email Service binding that keeps what it was asked to send. */
function fakeEmail(): { readonly sender: EmailSender; readonly sent: Sent[] } {
  const sent: Sent[] = [];
  const sender: EmailSender = {
    async send(message: unknown) {
      const fields = Object(message);
      sent.push({ to: fields.to, subject: String(fields.subject), text: String(fields.text) });
      return { messageId: `m${sent.length}` };
    },
  };
  return { sender, sent };
}

function linkToken(mail: Sent | undefined): string {
  const match = /token=([A-Za-z0-9_-]+)/.exec(mail?.text ?? '');
  if (match?.[1] === undefined) throw new Error('the mail has no link');
  return match[1];
}

const BASE = { origin: 'https://beanstalk.test', ip: '198.51.100.1', now: T0 };

describe('email sign-in configuration', () => {
  it('is off without a sender domain or without the binding', () => {
    const { sender } = fakeEmail();
    expect(emailSignInConfig({})).toBeNull();
    expect(emailSignInConfig({ EMAIL_SENDER_DOMAIN: '', EMAIL: sender })).toBeNull();
    expect(emailSignInConfig({ EMAIL_SENDER_DOMAIN: 'beanstalk.test' })).toBeNull();
    expect(
      emailSignInConfig({ EMAIL_SENDER_DOMAIN: 'beanstalk.test', EMAIL: sender })?.from,
    ).toEqual({
      email: 'signin@beanstalk.test',
      name: 'Beanstalk',
    });
  });
});

describe('magic links', () => {
  it('signs up a new person with a verified email, once, in the asking browser', async () => {
    const { sender, sent } = fakeEmail();
    const config = { sender, from: { email: 'signin@beanstalk.test', name: 'Beanstalk' } };
    await requestMagicLink(env, config, {
      ...BASE,
      email: 'new@example.com',
      handle: 'newbie',
      browserSecret: 'browser-a',
    });
    expect(sent[0]).toMatchObject({
      to: 'new@example.com',
      subject: 'Finish signing up for Beanstalk',
    });
    const token = linkToken(sent[0]);
    const elsewhere = await consumeMagicLink(env, {
      token,
      browserSecret: 'browser-b',
      userAgent: null,
      ip: null,
      now: T0,
    });
    expect(elsewhere).toEqual({ ok: false, reason: 'other_browser' });
    const opened = await consumeMagicLink(env, {
      token,
      browserSecret: 'browser-a',
      userAgent: null,
      ip: null,
      now: T0 + 1,
    });
    if (!opened.ok) throw new Error(opened.reason);
    expect(opened.user).toMatchObject({ handle: 'newbie', email: 'new@example.com' });
    expect(opened.created).toBe(true);
    expect(await getSessionUser(withSession(opened.session.secret), env, () => T0)).toEqual(
      opened.user,
    );
    const replay = await consumeMagicLink(env, {
      token,
      browserSecret: 'browser-a',
      userAgent: null,
      ip: null,
      now: T0 + 2,
    });
    expect(replay).toEqual({ ok: false, reason: 'invalid' });
  });

  it('signs in an existing person and ignores a handle they did not need', async () => {
    const { sender, sent } = fakeEmail();
    const config = { sender, from: { email: 'signin@beanstalk.test', name: 'Beanstalk' } };
    await requestMagicLink(env, config, {
      ...BASE,
      email: 'back@example.com',
      handle: 'back',
      browserSecret: 'b',
    });
    const created = await consumeMagicLink(env, {
      token: linkToken(sent[0]),
      browserSecret: 'b',
      userAgent: null,
      ip: null,
      now: T0,
    });
    await requestMagicLink(env, config, {
      ...BASE,
      email: 'BACK@example.com',
      handle: 'ignored',
      browserSecret: 'b',
    });
    expect(sent[1]?.subject).toBe('Sign in to Beanstalk');
    const again = await consumeMagicLink(env, {
      token: linkToken(sent[1]),
      browserSecret: 'b',
      userAgent: null,
      ip: null,
      now: T0,
    });
    if (!created.ok || !again.ok) throw new Error('both links should work');
    expect(again.user).toEqual(created.user);
    expect(again.created).toBe(false);
  });

  it('expires after 15 minutes', async () => {
    const { sender, sent } = fakeEmail();
    const config = { sender, from: { email: 'signin@beanstalk.test', name: 'Beanstalk' } };
    await requestMagicLink(env, config, {
      ...BASE,
      email: 'late@example.com',
      handle: 'late',
      browserSecret: 'b',
    });
    const late = await consumeMagicLink(env, {
      token: linkToken(sent[0]),
      browserSecret: 'b',
      userAgent: null,
      ip: null,
      now: T0 + 15 * 60_000,
    });
    expect(late).toEqual({ ok: false, reason: 'invalid' });
  });

  it('tells an address with no account how to sign up, without a link that signs in', async () => {
    const { sender, sent } = fakeEmail();
    const config = { sender, from: { email: 'signin@beanstalk.test', name: 'Beanstalk' } };
    await requestMagicLink(env, config, {
      ...BASE,
      email: 'nobody@example.com',
      handle: null,
      browserSecret: 'b',
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain('has no account yet');
    expect(sent[0]?.text).not.toContain('token=');
  });

  it('refuses a sign-up whose handle was taken after the link was sent', async () => {
    const { sender, sent } = fakeEmail();
    const config = { sender, from: { email: 'signin@beanstalk.test', name: 'Beanstalk' } };
    await requestMagicLink(env, config, {
      ...BASE,
      email: 'one@example.com',
      handle: 'samehandle',
      browserSecret: 'b',
    });
    await requestMagicLink(env, config, {
      ...BASE,
      email: 'two@example.com',
      handle: 'samehandle',
      browserSecret: 'b',
    });
    const first = await consumeMagicLink(env, {
      token: linkToken(sent[0]),
      browserSecret: 'b',
      userAgent: null,
      ip: null,
      now: T0,
    });
    const second = await consumeMagicLink(env, {
      token: linkToken(sent[1]),
      browserSecret: 'b',
      userAgent: null,
      ip: null,
      now: T0,
    });
    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, reason: 'handle_taken' });
  });
});
