'use server';

/**
 * Organizations: create, settings, members and invitations, leaving, deletion, and moving a
 * repository between a person and an org. Each action checks same origin, the session and its
 * CSRF token (`signedInForm`); who may do what is decided in `@beanstalk/shared-identity`
 * (org roles) and by the gateway (repositories). No rule lives here.
 */
import { env } from 'cloudflare:workers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { createOrg, deleteOrg, updateOrg } from '@beanstalk/shared-identity/org-admin';
import type { OrgResult } from '@beanstalk/shared-identity/org-admin';
import {
  answerOrgInvitation,
  cancelOrgInvitation,
  inviteToOrg,
  removeOrgMember,
  setOrgMemberRole,
} from '@beanstalk/shared-identity/org-members';
import { OrgRole, UpdateOrgInput } from '@beanstalk/shared-identity/orgs';

import { log } from '../log';
import { registryClient } from '../repositories/registry-client';
import { repositoryPath } from '../repositories/paths';
import { field, signedInForm } from './signed-in-form';

export type OrgState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'done'; readonly message: string }
  | { readonly kind: 'refused'; readonly message: string };

type Actor = { readonly id: string; readonly handle: string };

export async function createOrgAction(_previous: OrgState, form: FormData): Promise<OrgState> {
  const checked = await signedInForm(form);
  if ('kind' in checked) return checked;
  const created = await createOrg(
    env,
    actorOf(checked.session),
    {
      handle: field(form, 'handle'),
      name: field(form, 'name'),
      description: field(form, 'description'),
    },
    Date.now(),
  );
  if (!created.ok) return refused(created);
  log.info('org created');
  return redirect(`/${created.value.handle}`);
}

/** Saves one settings section: general (name, description) or repository defaults. */
export async function updateOrgAction(_previous: OrgState, form: FormData): Promise<OrgState> {
  const checked = await signedInForm(form);
  if ('kind' in checked) return checked;
  const patch = UpdateOrgInput.safeParse(settingsFields(form));
  if (!patch.success)
    return { kind: 'refused', message: patch.error.issues[0]?.message ?? 'Check the form.' };
  const updated = await updateOrg(
    env,
    actorOf(checked.session),
    field(form, 'org'),
    patch.data,
    Date.now(),
  );
  if (!updated.ok) return refused(updated);
  revalidateFrom(form);
  return { kind: 'done', message: 'Saved.' };
}

export async function inviteOrgMemberAction(
  _previous: OrgState,
  form: FormData,
): Promise<OrgState> {
  const checked = await signedInForm(form);
  if ('kind' in checked) return checked;
  const role = OrgRole.safeParse(form.get('role'));
  if (!role.success) return { kind: 'refused', message: 'Pick owner, admin, member or viewer.' };
  const invited = await inviteToOrg(
    env,
    {
      actor: actorOf(checked.session),
      orgId: field(form, 'org'),
      invite: { handle: field(form, 'handle'), role: role.data },
    },
    Date.now(),
  );
  if (!invited.ok) return refused(invited);
  log.info('org member invited', { role: role.data });
  revalidateFrom(form);
  return {
    kind: 'done',
    message: `Invited @${invited.value.inviteeHandle} as ${invited.value.role}. They accept on their Home.`,
  };
}

export async function cancelOrgInvitationAction(
  _previous: OrgState,
  form: FormData,
): Promise<OrgState> {
  const checked = await signedInForm(form);
  if ('kind' in checked) return checked;
  const cancelled = await cancelOrgInvitation(
    env,
    {
      actor: actorOf(checked.session),
      orgId: field(form, 'org'),
      invitationId: field(form, 'invitation'),
    },
    Date.now(),
  );
  if (!cancelled.ok) return refused(cancelled);
  revalidateFrom(form);
  return { kind: 'done', message: 'Invitation cancelled.' };
}

export async function setOrgRoleAction(_previous: OrgState, form: FormData): Promise<OrgState> {
  const checked = await signedInForm(form);
  if ('kind' in checked) return checked;
  const role = OrgRole.safeParse(form.get('role'));
  if (!role.success) return { kind: 'refused', message: 'Pick owner, admin, member or viewer.' };
  const changed = await setOrgMemberRole(
    env,
    {
      actor: actorOf(checked.session),
      orgId: field(form, 'org'),
      userId: field(form, 'user'),
      role: role.data,
    },
    Date.now(),
  );
  if (!changed.ok) return refused(changed);
  log.info('org role changed', { role: role.data });
  revalidateFrom(form);
  return { kind: 'done', message: `@${changed.value.handle} is now ${role.data}.` };
}

/** Removes a member (owners and admins), or leaves (the actor themself, then Home). */
export async function removeOrgMemberAction(
  _previous: OrgState,
  form: FormData,
): Promise<OrgState> {
  const checked = await signedInForm(form);
  if ('kind' in checked) return checked;
  const actor = actorOf(checked.session);
  const userId = field(form, 'user');
  const removed = await removeOrgMember(
    env,
    { actor, orgId: field(form, 'org'), userId },
    Date.now(),
  );
  if (!removed.ok) return refused(removed);
  if (userId === actor.id) {
    log.info('org member left');
    redirect(`/?left=${encodeURIComponent(field(form, 'orgHandle'))}`);
  }
  log.info('org member removed');
  revalidateFrom(form);
  return { kind: 'done', message: 'Removed.' };
}

export async function answerOrgInvitationAction(
  _previous: OrgState,
  form: FormData,
): Promise<OrgState> {
  const checked = await signedInForm(form);
  if ('kind' in checked) return checked;
  const answer = field(form, 'answer') === 'accept' ? 'accept' : 'decline';
  const answered = await answerOrgInvitation(
    env,
    { user: actorOf(checked.session), invitationId: field(form, 'invitation'), answer },
    Date.now(),
  );
  if (!answered.ok) return refused(answered);
  log.info('org invitation answered', { answer });
  if (answer === 'accept') redirect(`/${answered.value.orgHandle}`);
  revalidatePath('/');
  return { kind: 'done', message: 'Declined.' };
}

/** Deletes the org once it owns no repositories and the handle was typed exactly. */
export async function deleteOrgAction(_previous: OrgState, form: FormData): Promise<OrgState> {
  const checked = await signedInForm(form);
  if ('kind' in checked) return checked;
  const handle = field(form, 'orgHandle');
  if (field(form, 'confirm') !== handle)
    return { kind: 'refused', message: `Type ${handle} to confirm the deletion.` };
  const actor = actorOf(checked.session);
  const orgId = field(form, 'org');
  const registry = registryClient(env.GATEWAY);
  const [active, archived] = await Promise.all([
    registry.list(orgId, actor.id),
    registry.list(orgId, actor.id, 'archived'),
  ]);
  if (!active.ok || !archived.ok)
    return { kind: 'refused', message: 'Its repositories could not be listed; try again.' };
  const owned = active.value.length + archived.value.length;
  if (owned > 0)
    return {
      kind: 'refused',
      message: `${handle} still owns ${owned} ${owned === 1 ? 'repository' : 'repositories'}: delete or transfer them first.`,
    };
  const deleted = await deleteOrg(env, actor, orgId, Date.now());
  if (!deleted.ok) return refused(deleted);
  log.info('org deleted');
  return redirect(`/?deleted=${encodeURIComponent(handle)}`);
}

/** Moves a repository to the person or an org they administer; the gateway decides. */
export async function transferRepositoryAction(
  _previous: OrgState,
  form: FormData,
): Promise<OrgState> {
  const checked = await signedInForm(form);
  if ('kind' in checked) return checked;
  const to = field(form, 'to');
  if (to === '') return { kind: 'refused', message: 'Pick where it goes.' };
  const moved = await registryClient(env.GATEWAY).transfer(
    checked.session.user.id,
    field(form, 'repo'),
    to,
  );
  if (!moved.ok) return { kind: 'refused', message: sentence(moved.error.message) };
  log.info('repository transferred');
  return redirect(`${repositoryPath(moved.value.owner.handle, moved.value.name)}/settings`);
}

/** The settings fields this form carried; absent ones stay as they are. */
function settingsFields(form: FormData): Readonly<Record<string, string>> {
  const names = ['name', 'description', 'basePermission', 'repoCreation', 'defaultVisibility'];
  return Object.fromEntries(
    names.filter((name) => form.has(name)).map((name) => [name, field(form, name)]),
  );
}

function actorOf(session: { readonly user: Actor }): Actor {
  return { id: session.user.id, handle: session.user.handle };
}

function refused(result: Extract<OrgResult<unknown>, { ok: false }>): OrgState {
  return { kind: 'refused', message: sentence(result.error.message) };
}

function revalidateFrom(form: FormData): void {
  const path = form.get('path');
  if (typeof path === 'string' && path.startsWith('/') && !path.startsWith('//'))
    revalidatePath(path);
}

/** A message as a sentence: capitalised, ending in a full stop. */
function sentence(message: string): string {
  const trimmed = message.trim();
  const capital = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
}
