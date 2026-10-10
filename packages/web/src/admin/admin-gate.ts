/**
 * The admin area's gate, server-only. Anyone who is not a platform admin (signed out included)
 * gets the ordinary 404: the area is never revealed by a 403 or a sign-in prompt.
 */
import { env } from 'cloudflare:workers';
import { notFound, redirect } from 'next/navigation';

import type { User } from '../auth/user';
import { currentUser, getUser } from '../auth/user';
import { adminPathOf } from './admin-paths';
import { isPlatformAdmin } from './platform-admins';

/** The PLATFORM_ADMINS var ('' when unset: nobody is an admin). */
export function configuredPlatformAdmins(): string {
  return typeof env.PLATFORM_ADMINS === 'string' ? env.PLATFORM_ADMINS : '';
}

/** Whether the person signed in on this request (server components, actions) is an admin. */
export async function viewerIsPlatformAdmin(): Promise<boolean> {
  return isPlatformAdmin(await currentUser(), configuredPlatformAdmins());
}

/** The signed-in admin; anyone else gets the not-found page. Every admin page calls this. */
export async function requirePlatformAdmin(): Promise<User> {
  const user = await currentUser();
  if (user === null || !isPlatformAdmin(user, configuredPlatformAdmins())) notFound();
  return user;
}

/** A route handler's signed-in platform admin; null for anyone else (answer them with a 404). */
export async function platformAdminOf(request: Request): Promise<User | null> {
  const user = await getUser(request);
  return isPlatformAdmin(user, configuredPlatformAdmins()) ? user : null;
}

/** An old public race URL: admins go to its admin page, everyone else gets the 404. */
export async function redirectToAdmin(publicPath: string, query: URLSearchParams): Promise<never> {
  const target = adminPathOf(publicPath, query);
  if (target === null || !(await viewerIsPlatformAdmin())) notFound();
  redirect(target);
}
