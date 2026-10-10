'use server';

/**
 * Creating a personal access token. A server action, so the plain token comes back to the
 * page once, in the action's result, and is never stored or logged. Same origin and the
 * session's CSRF token are checked as for every account form.
 */
import { env } from 'cloudflare:workers';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

import { getWebSession, isValidCsrf } from '@gitstalk/shared-identity/sessions';
import { PersonalTokenInput, createPersonalToken } from '@gitstalk/shared-identity/user-tokens';

export type CreateTokenState =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'created';
      readonly token: string;
      readonly name: string;
      readonly expiresAt: number;
    }
  | { readonly kind: 'refused'; readonly message: string };

export async function createTokenAction(
  _previous: CreateTokenState,
  formData: FormData,
): Promise<CreateTokenState> {
  const requestHeaders = await headers();
  const origin = requestHeaders.get('origin');
  const host = requestHeaders.get('host');
  if (origin === null || host === null || new URL(origin).host !== host)
    return { kind: 'refused', message: 'Cross-site requests are refused.' };
  const session = await getWebSession(requestHeaders.get('cookie'), env);
  if (session === null) return { kind: 'refused', message: 'Sign in again.' };
  if (!(await isValidCsrf(session, formData.get('csrf'))))
    return { kind: 'refused', message: 'Reload the page and try again.' };
  const request = PersonalTokenInput.safeParse({
    name: formData.get('name'),
    scopes: formData.getAll('scope'),
    days: formData.get('days'),
  });
  if (!request.success)
    return { kind: 'refused', message: request.error.issues[0]?.message ?? 'Check the form.' };
  const { token, summary } = await createPersonalToken(env, {
    userId: session.user.id,
    request: request.data,
    ip: requestHeaders.get('cf-connecting-ip'),
  });
  // The list beside the form re-renders with the new row; the plain token stays in this result.
  revalidatePath('/settings/tokens');
  return { kind: 'created', token, name: summary.name, expiresAt: summary.expiresAt };
}
