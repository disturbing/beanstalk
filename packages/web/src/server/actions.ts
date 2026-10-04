'use server';

/**
 * Server actions: signing in and out of the demo gate, and answering a decision card. The
 * gateway does not authenticate RPC calls (the binding is the trust boundary), so every
 * decision is checked against the signed session here first.
 */
import { env } from 'cloudflare:workers';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { RunId, TaskId } from '@beanstalk/shared-race/ids';

import { SESSION_COOKIE, SESSION_SECONDS, isDemoPassword, sessionToken } from '../auth/session';
import { forgeForRun } from '../forge/sources';
import { log } from '../log';
import { CardId } from '@beanstalk/shared-ask/race/race-events';
import { demoPassword, isSignedIn } from './viewer';

/** Where to go after signing in: a path on this site only. */
const NextPath = z
  .string()
  .regex(/^\/(?!\/)[\w\-./?=&%]*$/)
  .catch('/');

export async function signIn(formData: FormData): Promise<void> {
  const next = NextPath.parse(formData.get('next') ?? '/');
  const attempt = formData.get('password');
  const password = demoPassword();
  if (typeof attempt !== 'string' || !(await isDemoPassword(attempt, password))) {
    redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  }
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const jar = await cookies();
  jar.set(SESSION_COOKIE, await sessionToken(password, expiresAt), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_SECONDS,
  });
  redirect(next);
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  redirect('/');
}

export type DecisionState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'decided'; readonly winner: string }
  | { readonly kind: 'refused'; readonly message: string };

const DecisionForm = z.strictObject({
  run: RunId,
  card: CardId,
  winner: TaskId,
  /** The decision in one line, optional; the gateway keeps at most 2,000 characters. */
  text: z.string().trim().max(2000).optional(),
});

export async function decideCard(
  _previous: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  if (!(await isSignedIn()))
    return { kind: 'refused', message: 'Sign in with the demo password first.' };
  const parsed = DecisionForm.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { kind: 'refused', message: 'That is not a card of this run.' };
  const { run, card, winner, text } = parsed.data;
  const answer = { winner, actor: 'demo', ...(text === undefined || text === '' ? {} : { text }) };
  const outcome = await forgeForRun(env.GATEWAY, run).decide(run, card, answer);
  if (!outcome.ok) {
    log.warn('decision refused', { run, card, winner, code: outcome.code });
    return { kind: 'refused', message: outcome.message };
  }
  log.info('decision made', { run, card, winner });
  return { kind: 'decided', winner };
}
