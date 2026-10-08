'use server';

/**
 * Actions' writes from the web: run a workflow by hand, cancel or re-run a run, and add,
 * update or delete a repository secret. Each checks the form (same origin, session, CSRF),
 * then the person's role on the repository (`owner` and `name` fields: maintain or owner), before the control plane
 * checks it again. Secret values pass through once and are never logged or returned.
 */
import { env } from 'cloudflare:workers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { PutSecretInput } from '../actions/actions-contract';
import { dispatchOf } from '../actions/run-view';
import { dispatchInputsOf } from '../actions/run-filters';
import { lookupRepository } from '../repositories/flows';
import { repositoryPath } from '../repositories/paths';
import { registryClient } from '../repositories/registry-client';
import type { ActionsSession } from './actions-source';
import { actionsSession } from './actions-source';
import { field, signedInForm } from './signed-in-form';

export type WorkflowFormState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'done'; readonly message: string }
  | { readonly kind: 'refused'; readonly message: string };

type Maintainer = { readonly base: string; readonly actions: ActionsSession };

export async function dispatchWorkflowAction(
  _previous: WorkflowFormState,
  form: FormData,
): Promise<WorkflowFormState> {
  const scope = await maintainerOf(form);
  if ('kind' in scope) return scope;
  const workflows = await scope.actions.client.workflows();
  if (!workflows.ok) return refused(workflows.error.message);
  const workflow = workflows.value.find((candidate) => candidate.id === field(form, 'workflow'));
  const dispatch = workflow === undefined ? null : dispatchOf(workflow);
  if (workflow === undefined || dispatch === null)
    return refused('This workflow cannot be run by hand.');
  const inputs = dispatchInputsOf(dispatch.inputs, form);
  if (!inputs.ok) return refused(inputs.message);
  const started = await scope.actions.client.dispatch({
    workflow: workflow.id,
    ref: 'stalk',
    inputs: inputs.inputs,
  });
  if (!started.ok) return refused(started.error.message);
  await scope.actions.persist();
  return redirect(`${scope.base}/actions/runs/${encodeURIComponent(started.value.runId)}`);
}

export async function cancelRunAction(
  _previous: WorkflowFormState,
  form: FormData,
): Promise<WorkflowFormState> {
  const scope = await maintainerOf(form);
  if ('kind' in scope) return scope;
  const cancelled = await scope.actions.client.cancel(field(form, 'run'));
  if (!cancelled.ok) return refused(cancelled.error.message);
  await scope.actions.persist();
  revalidatePath(`${scope.base}/actions`, 'layout');
  return { kind: 'done', message: 'Cancelling: running steps are stopped within seconds.' };
}

/** Re-run: the same workflow dispatched again on the stalk with the run's inputs. */
export async function rerunRunAction(
  _previous: WorkflowFormState,
  form: FormData,
): Promise<WorkflowFormState> {
  const scope = await maintainerOf(form);
  if ('kind' in scope) return scope;
  const run = await scope.actions.client.run(field(form, 'run'));
  if (!run.ok) return refused(run.error.message);
  if (!run.value.canRerun)
    return refused('Only workflows with workflow_dispatch can be re-run here.');
  const started = await scope.actions.client.dispatch({
    workflow: run.value.workflowId,
    ref: 'stalk',
    inputs: run.value.inputs,
  });
  if (!started.ok) return refused(started.error.message);
  await scope.actions.persist();
  return redirect(`${scope.base}/actions/runs/${encodeURIComponent(started.value.runId)}`);
}

export async function putSecretAction(
  _previous: WorkflowFormState,
  form: FormData,
): Promise<WorkflowFormState> {
  const scope = await maintainerOf(form);
  if ('kind' in scope) return scope;
  const mode = field(form, 'mode');
  const input = PutSecretInput.safeParse({
    name: field(form, 'secret'),
    value: mode === 'toggle' ? null : field(form, 'value'),
    availableToPreland: form.get('preland') === 'on' || form.get('preland') === 'true',
  });
  if (!input.success) return refused(input.error.issues[0]?.message ?? 'Check the form.');
  const saved = await scope.actions.client.putSecret(input.data);
  if (!saved.ok) return refused(saved.error.message);
  await scope.actions.persist();
  revalidatePath(`${scope.base}/settings`);
  return {
    kind: 'done',
    message:
      mode === 'toggle'
        ? `${saved.value.name} is ${saved.value.availableToPreland ? 'now' : 'no longer'} available to pre-land checks.`
        : `Saved ${saved.value.name}. Its value cannot be shown again.`,
  };
}

export async function deleteSecretAction(
  _previous: WorkflowFormState,
  form: FormData,
): Promise<WorkflowFormState> {
  const scope = await maintainerOf(form);
  if ('kind' in scope) return scope;
  const name = field(form, 'secret');
  const deleted = await scope.actions.client.deleteSecret(name);
  if (!deleted.ok) return refused(deleted.error.message);
  await scope.actions.persist();
  revalidatePath(`${scope.base}/settings`);
  return { kind: 'done', message: `Deleted ${name}.` };
}

/** The form's person, if they maintain or own the repository named by `owner` and `name`. */
async function maintainerOf(
  form: FormData,
): Promise<Maintainer | { readonly kind: 'refused'; readonly message: string }> {
  const checked = await signedInForm(form);
  if ('kind' in checked) return checked;
  const user = checked.session.user;
  const found = await lookupRepository(
    field(form, 'owner'),
    field(form, 'name'),
    user,
    registryClient(env.GATEWAY),
  );
  if (found.kind === 'not-found') return refused('No such repository.');
  if (found.role !== 'owner' && found.role !== 'maintain')
    return refused('Only maintainers and the owner can do this.');
  const actions = await actionsSession({
    actor: { id: user.id, handle: user.handle },
    repoId: found.record.id,
  });
  if (actions === null) return refused('Actions are not running on this deployment.');
  return { base: repositoryPath(found.record.owner.handle, found.record.name), actions };
}

function refused(message: string): { readonly kind: 'refused'; readonly message: string } {
  return { kind: 'refused', message };
}
