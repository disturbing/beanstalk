/**
 * The run routes (`/runs/<run>…`, `/api/runs/<run>/…`) serve races by engine id. A persistent
 * repository's engine is a run too, so these routes ask the gateway first (`engineAccess`, i.e.
 * `mayUseEngine`): a race answers "no repository" and stays open as before; a repository is
 * served only to people who may read it, and is missing for everyone else.
 */
import type { RepositoryAction } from '@gitstalk/shared-race/collaborators';
import type { Viewer } from '@gitstalk/shared-race/repos';

import type { RepositoryForViewer } from './registry-client';
import { collaboratorsClient } from './collaborators-client';

export type EngineVerdict =
  | { readonly kind: 'race' }
  | { readonly kind: 'repository'; readonly repository: RepositoryForViewer }
  | { readonly kind: 'refused'; readonly code: string; readonly message: string };

/** What `viewer` may do with the engine `run`, as the gateway decides it. */
export async function engineVerdict(
  binding: object,
  input: { readonly run: string; readonly viewer: Viewer; readonly action: RepositoryAction },
): Promise<EngineVerdict> {
  const access = await collaboratorsClient(binding).engineAccess(
    input.run,
    input.viewer,
    input.action,
  );
  if (!access.ok) return { kind: 'refused', ...access.error };
  const { repository } = access.value;
  return repository === null ? { kind: 'race' } : { kind: 'repository', repository };
}

/** Whether a run route may show this engine to the viewer at all. */
export async function mayViewEngine(
  binding: object,
  run: string,
  viewer: Viewer,
): Promise<boolean> {
  const verdict = await engineVerdict(binding, { run, viewer, action: 'read' });
  return verdict.kind !== 'refused';
}
