'use server';

/**
 * Server actions for repositories: create, change settings, archive, delete. Each one asks accounts
 * who is signed in, runs the flow (`src/repositories/flows.ts`) and redirects or answers
 * the form's new state. The gateway checks ownership again on every change.
 */
import { env } from 'cloudflare:workers';
import { redirect } from 'next/navigation';

import { signedInUser } from './signed-in';
import { log } from '../log';
import type { CreateState, FormOutcome, SettingsState } from '../repositories/flows';
import { archiveFlow, createFlow, deleteFlow, updateFlow } from '../repositories/flows';
import { registryClient } from '../repositories/registry-client';

export async function createRepository(
  _previous: CreateState,
  form: FormData,
): Promise<CreateState> {
  const user = await signedInUser('/new');
  return settle(await createFlow(form, user, registryClient(env.GATEWAY)), 'create');
}

export async function updateRepository(
  _previous: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  const user = await signedInUser('/');
  return settle(await updateFlow(form, user, registryClient(env.GATEWAY)), 'update');
}

export async function deleteRepository(
  _previous: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  const user = await signedInUser('/');
  return settle(await deleteFlow(form, user, registryClient(env.GATEWAY)), 'delete');
}

export async function archiveRepository(
  _previous: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  const user = await signedInUser('/');
  return settle(await archiveFlow(form, user, registryClient(env.GATEWAY)), 'archive');
}

function settle<State>(outcome: FormOutcome<State>, action: string): State {
  if (outcome.kind === 'redirect') {
    log.info('repository action done', { action });
    redirect(outcome.to);
  }
  return outcome.state;
}
