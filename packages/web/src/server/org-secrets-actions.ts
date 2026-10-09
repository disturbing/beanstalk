'use server';

/**
 * Org Settings → Secrets and variables, the writes: add, update or delete an org secret or
 * variable, with its repository access policy. Each checks the form (same origin, session,
 * CSRF); the gateway then checks the org role (owners and admins). Secret values pass through
 * once and are never logged or returned.
 */
import { revalidatePath } from 'next/cache';

import type { AccessPolicy } from '../actions/actions-contract';
import { PutOrgSecretInput, PutOrgVariableInput } from '../actions/actions-contract';
import type { OrgActionsClient } from '../actions/org-actions-client';
import { orgActionsFor } from './org-actions-source';
import { field, signedInForm } from './signed-in-form';
import type { WorkflowFormState } from './workflow-actions';

type OrgScope = { readonly client: OrgActionsClient; readonly path: string };

export async function putOrgSecretAction(
  _previous: WorkflowFormState,
  form: FormData,
): Promise<WorkflowFormState> {
  const scope = await orgScopeOf(form);
  if ('kind' in scope) return scope;
  const keep = field(form, 'mode') === 'keep';
  const input = PutOrgSecretInput.safeParse({
    name: field(form, 'secret'),
    value: keep ? null : field(form, 'value'),
    access: accessOf(form),
    prelandAllowed: form.get('preland') === 'on' || form.get('preland') === 'true',
  });
  if (!input.success) return refused(input.error.issues[0]?.message ?? 'Check the form.');
  const saved = await scope.client.putSecret(input.data);
  if (!saved.ok) return refused(saved.error.message);
  revalidatePath(scope.path);
  return {
    kind: 'done',
    message: keep
      ? `Updated ${saved.value.name}'s access.`
      : `Saved ${saved.value.name}. Its value cannot be shown again.`,
  };
}

export async function deleteOrgSecretAction(
  _previous: WorkflowFormState,
  form: FormData,
): Promise<WorkflowFormState> {
  const scope = await orgScopeOf(form);
  if ('kind' in scope) return scope;
  const name = field(form, 'secret');
  const deleted = await scope.client.deleteSecret(name);
  if (!deleted.ok) return refused(deleted.error.message);
  revalidatePath(scope.path);
  return { kind: 'done', message: `Deleted ${name}.` };
}

export async function putOrgVariableAction(
  _previous: WorkflowFormState,
  form: FormData,
): Promise<WorkflowFormState> {
  const scope = await orgScopeOf(form);
  if ('kind' in scope) return scope;
  const input = PutOrgVariableInput.safeParse({
    name: field(form, 'variable'),
    value: field(form, 'value'),
    access: accessOf(form),
  });
  if (!input.success) return refused(input.error.issues[0]?.message ?? 'Check the form.');
  const saved = await scope.client.putVariable(input.data);
  if (!saved.ok) return refused(saved.error.message);
  revalidatePath(scope.path);
  return { kind: 'done', message: `Saved ${saved.value.name}.` };
}

export async function deleteOrgVariableAction(
  _previous: WorkflowFormState,
  form: FormData,
): Promise<WorkflowFormState> {
  const scope = await orgScopeOf(form);
  if ('kind' in scope) return scope;
  const name = field(form, 'variable');
  const deleted = await scope.client.deleteVariable(name);
  if (!deleted.ok) return refused(deleted.error.message);
  revalidatePath(scope.path);
  return { kind: 'done', message: `Deleted ${name}.` };
}

/** The repository access policy a form picked (`access`, and `repo` once per selected one). */
function accessOf(form: FormData): AccessPolicy {
  const access = field(form, 'access');
  if (access === 'private') return { kind: 'private' };
  if (access === 'selected')
    return {
      kind: 'selected',
      repoIds: form.getAll('repo').filter((value): value is string => typeof value === 'string'),
    };
  return { kind: 'all' };
}

async function orgScopeOf(
  form: FormData,
): Promise<OrgScope | { readonly kind: 'refused'; readonly message: string }> {
  const checked = await signedInForm(form);
  if ('kind' in checked) return checked;
  const orgHandle = field(form, 'org');
  const client = orgActionsFor({ viewer: checked.session.user.id, orgHandle });
  if (client === null) return refused('Org secrets are not available on this deployment.');
  return { client, path: `/orgs/${encodeURIComponent(orgHandle)}/settings/secrets` };
}

function refused(message: string): { readonly kind: 'refused'; readonly message: string } {
  return { kind: 'refused', message };
}
