/**
 * The one place the registry meets the continuous engine (`docs/claude-opus/18`):
 * `openRepoEngine({ repoName, artifactsRepo, owner, settings? }) => { engineId, … }`, which is
 * idempotent, and `closeRepoEngine` on delete. The engine id comes from the Artifacts repo
 * (the repository's id), not the address, so a new repository at an address another one left
 * (a rename or a transfer) gets its own engine.
 */
import type { RepoOwner } from '@gitstalk/shared-race/repos';

import type { Deps } from '../deps';
import { GatewayError } from '../errors';
import { registryEngineId } from '../push/repo-engine';
import { openRepoEngine, repoEngineRpc } from '../rpc/repo-engine-rpc';

export type OpenRepoEngineInput = {
  readonly repoName: string;
  readonly artifactsRepo: string;
  readonly owner: RepoOwner;
  readonly settings?: Readonly<Record<string, unknown>>;
};

export type RepoEnginePort = {
  open(input: OpenRepoEngineInput): Promise<{ engineId: string }>;
  /** Stops the engine of a deleted repository (the registry deletes the Artifacts repo). */
  close(engineId: string): Promise<void>;
};

/** The real engine (git-native work): opens or finds the repository's continuous engine. */
export function repoEnginePort(deps: Deps): RepoEnginePort {
  return {
    async open(input) {
      const opened = await openRepoEngine(
        deps,
        { repoName: input.repoName, artifactsRepo: input.artifactsRepo, owner: input.owner },
        await registryEngineId(input.artifactsRepo),
      );
      if (!opened.ok) throw new GatewayError(opened.error.message, opened.error.code, 502);
      return { engineId: opened.value.engineId };
    },
    async close(engineId) {
      await repoEngineRpc(deps).closeRepoEngine(engineId, { deleteRepo: false });
    },
  };
}
