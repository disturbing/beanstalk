'use server';

/**
 * Collaborators: invite, cancel, change a role, remove, leave, and answer an invitation. Each
 * action checks same origin, the session and its CSRF token (`signedInForm`); the gateway then
 * decides with `mayUseEngine` (only the owner manages people; anyone leaves; only the invitee
 * answers). No access rule lives here.
 */
import { env } from 'cloudflare:workers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { InviteInput, RepoRole } from '@beanstalk/shared-race/collaborators';

import { log } from '../log';
import { collaboratorsClient } from '../repositories/collaborators-client';
import { repositoryPath } from '../repositories/paths';
import { field, signedInForm } from './signed-in-form';

export type CollaboratorState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'done'; readonly message: string }
  | { readonly kind: 'refused'; readonly message: string };

export async function inviteAction(
  _previous: CollaboratorState,
  form: FormData,
): Promise<CollaboratorState> {
  const checked = await signedInForm(form);
  if ('kind' in checked) return checked;
  const input = InviteInput.safeParse({ handle: form.get('handle'), role: form.get('role') });
  if (!input.success)
    return { kind: 'refused', message: input.error.issues[0]?.message ?? 'Check the form.' };
  const invited = await collaboratorsClient(env.GATEWAY).invite(
    actorOf(checked.session),
    field(form, 'repo'),
    input.data,
  );
  if (!invited.ok) return { kind: 'refused', message: sentence(invited.error.message) };
  log.info('collaborator invited', { role: input.data.role });
  revalidateFrom(form);
  return {
    kind: 'done',
    message: `Invited @${invited.value.invitee_handle} with the ${invited.value.role} role. They accept on their Home.`,
  };
}

export async function cancelInvitationAction(
  _previous: CollaboratorState,
  form: FormData,
): Promise<CollaboratorState> {
  const checked = await signedInForm(form);
  if ('kind' in checked) return checked;
  const cancelled = await collaboratorsClient(env.GATEWAY).cancel(
    actorOf(checked.session),
    field(form, 'repo'),
    field(form, 'invitation'),
  );
  if (!cancelled.ok) return { kind: 'refused', message: sentence(cancelled.error.message) };
  revalidateFrom(form);
  return { kind: 'done', message: 'Invitation cancelled.' };
}

export async function setRoleAction(
  _previous: CollaboratorState,
  form: FormData,
): Promise<CollaboratorState> {
  const checked = await signedInForm(form);
  if ('kind' in checked) return checked;
  const role = RepoRole.safeParse(form.get('role'));
  if (!role.success) return { kind: 'refused', message: 'Pick read, write or maintain.' };
  const changed = await collaboratorsClient(env.GATEWAY).setRole(
    actorOf(checked.session),
    field(form, 'repo'),
    field(form, 'user'),
    role.data,
  );
  if (!changed.ok) return { kind: 'refused', message: sentence(changed.error.message) };
  log.info('collaborator role changed', { role: role.data });
  revalidateFrom(form);
  return { kind: 'done', message: `@${changed.value.handle} now has the ${role.data} role.` };
}

/** Removes a collaborator (the owner), or leaves (the actor themself, then Home). */
export async function removeCollaboratorAction(
  _previous: CollaboratorState,
  form: FormData,
): Promise<CollaboratorState> {
  const checked = await signedInForm(form);
  if ('kind' in checked) return checked;
  const actor = actorOf(checked.session);
  const userId = field(form, 'user');
  const removed = await collaboratorsClient(env.GATEWAY).remove(actor, field(form, 'repo'), userId);
  if (!removed.ok) return { kind: 'refused', message: sentence(removed.error.message) };
  if (userId === actor.id) {
    log.info('collaborator left');
    redirect(`/?left=${encodeURIComponent(field(form, 'fullName'))}`);
  }
  log.info('collaborator removed');
  revalidateFrom(form);
  return { kind: 'done', message: 'Removed.' };
}

export async function answerInvitationAction(
  _previous: CollaboratorState,
  form: FormData,
): Promise<CollaboratorState> {
  const checked = await signedInForm(form);
  if ('kind' in checked) return checked;
  const answer = field(form, 'answer') === 'accept' ? 'accept' : 'decline';
  const answered = await collaboratorsClient(env.GATEWAY).answer(
    actorOf(checked.session),
    field(form, 'invitation'),
    answer,
  );
  if (!answered.ok) return { kind: 'refused', message: sentence(answered.error.message) };
  log.info('invitation answered', { answer });
  if (answer === 'accept')
    redirect(repositoryPath(answered.value.owner_handle, answered.value.repo_name));
  revalidatePath('/');
  return { kind: 'done', message: 'Declined.' };
}

function actorOf(session: { readonly user: { readonly id: string; readonly handle: string } }): {
  readonly id: string;
  readonly handle: string;
} {
  return { id: session.user.id, handle: session.user.handle };
}

function revalidateFrom(form: FormData): void {
  const path = form.get('path');
  if (typeof path === 'string' && path.startsWith('/') && !path.startsWith('//'))
    revalidatePath(path);
}

/** A gateway message as a sentence: capitalised, ending in a full stop. */
function sentence(message: string): string {
  const trimmed = message.trim();
  const capital = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
}
