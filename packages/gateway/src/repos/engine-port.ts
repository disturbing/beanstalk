/**
 * The one place the registry meets the continuous engine (owned by the engine/git work):
 * `openRepoEngine({ repoName, artifactsRepo, owner, settings? }) => { engineId }`. Until that
 * lands, a local stub answers with an engine id derived from the repository id; the run read
 * RPCs then answer `not_found` for it, which the web shows as "nothing has grown yet".
 * Replace `repoEnginePort`'s body when the real function exists; nothing else changes.
 */
import type { RepoOwner } from '@beanstalk/shared-race/repos';

export type OpenRepoEngineInput = {
  readonly repoName: string;
  readonly artifactsRepo: string;
  readonly owner: RepoOwner;
  readonly settings?: Readonly<Record<string, unknown>>;
};

export type RepoEnginePort = {
  open(input: OpenRepoEngineInput & { readonly repoId: string }): Promise<{ engineId: string }>;
  /** Stops the engine of a deleted repository (a no-op until the engine offers it). */
  close(engineId: string): Promise<void>;
  /** Which implementation answers, for logs and the empty-repository page. */
  readonly kind: 'stub' | 'engine';
};

export function repoEnginePort(): RepoEnginePort {
  return stubEnginePort();
}

/** The stand-in: the engine id is the repository id (a valid run id: 12 of [a-z0-9]). */
export function stubEnginePort(): RepoEnginePort {
  return {
    kind: 'stub',
    open: (input) => Promise.resolve({ engineId: input.repoId }),
    close: () => Promise.resolve(),
  };
}
