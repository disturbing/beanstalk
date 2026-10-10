'use server';

/**
 * Deploy tokens for one repository (its Settings, and the start page's Env vars tab): create
 * and revoke. Server actions, so a new token comes back to the page once, in the action's
 * result, and is never stored or logged here. Same origin and the session's CSRF token are
 * checked as for every account form; the gateway checks access again (owner or maintainer).
 */
import { env } from 'cloudflare:workers';
import { revalidatePath } from 'next/cache';

import { CreateDeployTokenInput } from '@gitstalk/shared-race/deploy-tokens';

import { deployTokensClient } from '../repositories/deploy-tokens-client';
import { field, signedInForm } from './signed-in-form';

export type DeployTokenState =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'created';
      readonly token: string;
      readonly name: string;
      readonly access: 'read' | 'write';
    }
  | { readonly kind: 'revoked' }
  | { readonly kind: 'refused'; readonly message: string };

export async function createDeployTokenAction(
  _previous: DeployTokenState,
  form: FormData,
): Promise<DeployTokenState> {
  const checked = await signedInForm(form);
  if ('kind' in checked) return checked;
  const input = CreateDeployTokenInput.safeParse({
    name: form.get('name'),
    access: form.get('access'),
    days: form.get('days'),
  });
  if (!input.success)
    return { kind: 'refused', message: input.error.issues[0]?.message ?? 'Check the form.' };
  const repoId = field(form, 'repo');
  const actor = { id: checked.session.user.id, handle: checked.session.user.handle };
  const made = await deployTokensClient(env.GATEWAY).create(actor, repoId, input.data);
  if (!made.ok) return { kind: 'refused', message: made.error.message };
  revalidateFrom(form);
  return {
    kind: 'created',
    token: made.value.token,
    name: made.value.summary.name,
    access: made.value.summary.access,
  };
}

export async function revokeDeployTokenAction(
  _previous: DeployTokenState,
  form: FormData,
): Promise<DeployTokenState> {
  const checked = await signedInForm(form);
  if ('kind' in checked) return checked;
  const actor = { id: checked.session.user.id, handle: checked.session.user.handle };
  const revoked = await deployTokensClient(env.GATEWAY).revoke(
    actor,
    field(form, 'repo'),
    field(form, 'token'),
  );
  if (!revoked.ok) return { kind: 'refused', message: revoked.error.message };
  revalidateFrom(form);
  return { kind: 'revoked' };
}

function revalidateFrom(form: FormData): void {
  const path = form.get('path');
  if (typeof path === 'string' && path.startsWith('/') && !path.startsWith('//'))
    revalidatePath(path);
}
