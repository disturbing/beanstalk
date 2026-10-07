import { env } from 'cloudflare:test';

import type { RelyingParty } from '../src/passkeys';
import { finishPasskeySignup, startPasskeySignup } from '../src/passkeys';
import type { SignedIn } from '../src/passkeys';
import { createVirtualAuthenticator } from '../src/testing/virtual-authenticator';
import type { VirtualAuthenticator } from '../src/testing/virtual-authenticator';

export const RP: RelyingParty = {
  id: 'beanstalk.test',
  name: 'Beanstalk',
  origin: 'https://beanstalk.test',
};
export const T0 = Date.parse('2026-10-07T12:00:00Z');

export function context(now = T0) {
  return {
    rp: RP,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    ip: '203.0.113.7',
    now,
  };
}

/** Signs a new person up with a fresh virtual passkey. */
export async function signUp(
  handle: string,
): Promise<SignedIn & { readonly authenticator: VirtualAuthenticator }> {
  const authenticator = await createVirtualAuthenticator();
  const started = await startPasskeySignup(env, { handle, rp: RP, now: T0 });
  if (!('options' in started)) throw new Error(`could not start a sign-up for ${handle}`);
  const response = await authenticator.register(started.options, RP.origin);
  const finished = await finishPasskeySignup(env, {
    handle: started.handle,
    response,
    context: context(),
  });
  if (!finished.ok) throw new Error(`sign-up failed: ${finished.reason}`);
  return { ...finished, authenticator };
}

/** A request carrying a session cookie. */
export function withSession(secret: string): Request {
  return new Request('https://beanstalk.test/', {
    headers: { cookie: `theme=night; __Host-bs_session=${secret}` },
  });
}
