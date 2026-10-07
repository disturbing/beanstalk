/**
 * The signed-in person for pages and actions that need one, or a redirect to sign in that
 * comes back to `next` (accounts: `src/auth/user.ts`). Server-only.
 */
import { redirect } from 'next/navigation';

import type { User } from '../auth/user';
import { currentUser } from '../auth/user';

export async function signedInUser(next: string): Promise<User> {
  const user = await currentUser();
  if (user === null) redirect(`/login?next=${encodeURIComponent(next)}`);
  return user;
}
