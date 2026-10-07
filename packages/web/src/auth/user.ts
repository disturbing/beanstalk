/**
 * The web app's one adapter onto accounts: who is signed in. Every page, route handler and
 * server action that needs a person goes through here, so the repository and settings code
 * never touches cookies or the identity database directly.
 *
 * - `requireUser(request)`: route handlers; throws `SignInRequired` (its `response()` is a 401).
 * - `getUser(request)`: route handlers; null when signed out.
 * - `currentUser()` / `currentSession()`: server components and actions (reads the request's
 *   cookies through next/headers).
 */
import { env } from 'cloudflare:workers';
import { headers } from 'next/headers';

import type { WebSession } from '@beanstalk/shared-identity/sessions';
import { getSessionUser, getWebSession } from '@beanstalk/shared-identity/sessions';
import type { SessionUser } from '@beanstalk/shared-identity/users';

/** A signed-in person: `{ id, handle, email }` (email null until one is verified). */
export type User = SessionUser;

export class SignInRequired extends Error {
  constructor() {
    super('sign in first');
    this.name = 'SignInRequired';
  }

  response(): Response {
    return Response.json(
      { error: { code: 'unauthorized', message: 'sign in first' } },
      { status: 401 },
    );
  }
}

export async function requireUser(request: Request): Promise<User> {
  const user = await getUser(request);
  if (user === null) throw new SignInRequired();
  return user;
}

export function getUser(request: Request): Promise<User | null> {
  return getSessionUser(request, env);
}

export async function currentSession(): Promise<WebSession | null> {
  const requestHeaders = await headers();
  return getWebSession(requestHeaders.get('cookie'), env);
}

export async function currentUser(): Promise<User | null> {
  return (await currentSession())?.user ?? null;
}
