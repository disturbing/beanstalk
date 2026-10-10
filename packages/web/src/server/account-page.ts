/**
 * The start of every `/settings/*` page: the signed-in session (or a redirect to sign in that
 * comes back here) and the person's profile for the settings frame. Server-only.
 */
import { env } from 'cloudflare:workers';
import { redirect } from 'next/navigation';

import type { Profile } from '@gitstalk/shared-identity/profiles';
import { getProfile } from '@gitstalk/shared-identity/profiles';
import type { WebSession } from '@gitstalk/shared-identity/sessions';

import { currentSession } from '../auth/user';

export type AccountPage = { readonly session: WebSession; readonly profile: Profile };

export async function accountPage(path: string): Promise<AccountPage> {
  const session = await currentSession();
  if (session === null) redirect(`/login?next=${encodeURIComponent(path)}`);
  const profile = await getProfile(env, session.user.id);
  if (profile === null) redirect(`/login?next=${encodeURIComponent(path)}`);
  return { session, profile };
}

/** A query parameter as one string, or undefined. */
export function queryValue(
  query: Readonly<Record<string, string | string[] | undefined>>,
  name: string,
): string | undefined {
  const value = query[name];
  return typeof value === 'string' ? value : undefined;
}
