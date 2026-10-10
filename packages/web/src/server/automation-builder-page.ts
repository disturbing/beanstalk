/**
 * The builder pages' start (doc 25 §7.13): the file at the latest landed commit and what the
 * person may do with it (from the gateway), the secret names they can pick (repository and org,
 * never values), the models, and the CSRF token the builder's calls carry. Server-only.
 */
import { env } from 'cloudflare:workers';

import { AUTOMATIONS_DIRS } from '@gitstalk/shared-race/actions';
import {
  AUTOMATION_MODELS,
  DEFAULT_AUTOMATION_MODEL,
} from '@gitstalk/shared-race/automation-models';

import type { BuilderProps } from '../../components/automations/automation-builder';
import { editorClient } from '../automations/editor-client';
import { currentSession } from '../auth/user';
import type { ActionsPage } from './actions-page';

export type BuilderStart =
  | { readonly kind: 'ready'; readonly props: BuilderProps }
  | { readonly kind: 'missing' }
  | { readonly kind: 'unavailable'; readonly message: string };

/**
 * The builder on an existing automation named `file`: `.gitstalk/automations/<file>`, else the
 * older `.beanstalk/automations/<file>`, edited where it is (`config-dir.ts` has the rule).
 */
export async function editStart(page: ActionsPage, file: string): Promise<BuilderStart> {
  const [current, ...older] = AUTOMATIONS_DIRS;
  let start = await builderStart(page, {
    mode: 'edit',
    path: `${current}/${file}`,
    template: null,
  });
  for (const dir of older) {
    if (start.kind !== 'missing') return start;
    // oxlint-disable-next-line no-await-in-loop -- the fallback is read only when the first is absent
    start = await builderStart(page, { mode: 'edit', path: `${dir}/${file}`, template: null });
  }
  return start;
}

export async function builderStart(
  page: ActionsPage,
  input: { readonly mode: 'new' | 'edit'; readonly path: string; readonly template: string | null },
): Promise<BuilderStart> {
  const client = editorClient(env.GATEWAY, page.user?.id ?? null);
  if (client === null)
    return {
      kind: 'unavailable',
      message: 'The automation builder is not running on this deployment.',
    };
  const [source, session, secretNames] = await Promise.all([
    client.source(page.record.id, input.path),
    page.user === null ? null : currentSession(),
    secretNamesOf(page),
  ]);
  if (!source.ok)
    return source.status === 404
      ? { kind: 'missing' }
      : { kind: 'unavailable', message: source.message };
  if (input.mode === 'edit' && source.value.content === null) return { kind: 'missing' };
  const text = input.mode === 'edit' ? (source.value.content ?? '') : (input.template ?? '');
  return {
    kind: 'ready',
    props: {
      mode: input.mode,
      repo: { owner: page.record.owner.handle, name: page.record.name, base: page.base },
      csrf: session?.csrfToken ?? null,
      path: source.value.path,
      opened: { base: source.value.base, text: source.value.content },
      initialText: text,
      save: source.value.save,
      canTestRun: source.value.canTestRun,
      secretNames,
      models: Object.keys(AUTOMATION_MODELS),
      defaultModel: DEFAULT_AUTOMATION_MODEL,
      maxTimeoutMinutes: source.value.maxTimeoutMinutes,
      nowMs: Date.now(),
    },
  };
}

/** Repository and org secret names the viewer may see (none without a role). */
async function secretNamesOf(page: ActionsPage): Promise<readonly string[]> {
  if (page.actions === null || page.role === null) return [];
  const entries = await page.actions.entries();
  if (entries.ok)
    return [...new Set(entries.value.secrets.map((secret) => secret.name))].toSorted();
  const secrets = await page.actions.secrets();
  return secrets.ok ? secrets.value.secrets.map((secret) => secret.name).toSorted() : [];
}
