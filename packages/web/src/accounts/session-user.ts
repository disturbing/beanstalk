/**
 * Who is signed in. The one adapter between the web app and accounts (owned by the accounts
 * work): `getSessionUser(request, env)` and `requireUser(request)`. Until accounts land, a
 * dev stub answers: when the `DEV_USER_HANDLE` var is set (staging only; empty everywhere
 * else) every request is that user, otherwise nobody is signed in. Replace the two function
 * bodies with the accounts calls; callers do not change.
 */
import { z } from 'zod';

export type SessionUser = {
  readonly id: string;
  readonly handle: string;
  readonly email: string;
};

/** The bindings this adapter reads (a slice of the generated `Env`). */
export type AccountsEnv = { readonly DEV_USER_HANDLE?: string };

const Handle = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/);

/** The signed-in user, or null. */
export function getSessionUser(_request: Request, env: AccountsEnv): Promise<SessionUser | null> {
  return Promise.resolve(devUser(env.DEV_USER_HANDLE));
}

/** The signed-in user; a SignInRequired error (the page redirects to sign in) otherwise. */
export async function requireUser(request: Request, env: AccountsEnv): Promise<SessionUser> {
  const user = await getSessionUser(request, env);
  if (user === null) throw new SignInRequired(new URL(request.url).pathname);
  return user;
}

export class SignInRequired extends Error {
  override readonly name = 'SignInRequired';
  readonly next: string;

  constructor(next: string) {
    super('sign in to continue');
    this.next = next;
  }
}

/** The fixed dev user for a handle, or null when the flag is off or the handle is invalid. */
export function devUser(handle: string | undefined): SessionUser | null {
  const parsed = Handle.safeParse(handle);
  if (!parsed.success) return null;
  const lower = parsed.data.toLowerCase();
  return { id: `u_dev_${lower}`, handle: parsed.data, email: `${lower}@dev.beanstalk.invalid` };
}
