/**
 * The signed-in user for server components and actions, which have headers rather than a
 * Request: builds one and asks the accounts adapter. Server-only.
 */
import { env } from 'cloudflare:workers';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import type { SessionUser } from './session-user';
import { getSessionUser } from './session-user';

export async function currentUser(): Promise<SessionUser | null> {
  return getSessionUser(await requestOf(), env);
}

/** The signed-in user, or a redirect to sign in that comes back to `next`. */
export async function signedInUser(next: string): Promise<SessionUser> {
  const user = await currentUser();
  if (user === null) redirect(`/login?next=${encodeURIComponent(next)}`);
  return user;
}

async function requestOf(): Promise<Request> {
  const incoming = await headers();
  const host = incoming.get('host') ?? 'localhost';
  return new Request(`https://${host}/`, { headers: new Headers(incoming) });
}
