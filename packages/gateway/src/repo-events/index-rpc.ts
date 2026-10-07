/**
 * The index RPC (`RepoIndexRpc`): the Stalk tab and Home's growth lines, read from D1. Access
 * is the registry's one rule (`accessResult`, read). A repository the index has not heard
 * from yet (one that grew before `repo-events` existed, or whose engine's last send failed)
 * asks its engine to catch up, in the background, so the next read has it.
 */
import type { RepoIndexRpc } from '@beanstalk/shared-race/repo-events';
import type { RpcResult } from '@beanstalk/shared-race/rpc';
import { RunId } from '@beanstalk/shared-race/ids';

import type { Logger } from '../log';
import { decideAccess, accessResult, viewerPrincipal } from '../repos/access';
import type { CollaboratorStore } from '../repos/collaborators';
import type { Registry } from '../repos/registry';
import type { RunDO } from '../run/run-do';
import { readGrowth, readStalk } from './index-store';

/** Repositories one growth call may ask about. */
const MAX_GROWTH_IDS = 100;

export type IndexRpcDeps = {
  readonly db: D1Database;
  readonly registry: Registry;
  readonly collaborators: CollaboratorStore;
  readonly engine: (engineId: RunId) => Pick<DurableObjectStub<RunDO>, 'catchUpRepoEvents'>;
  readonly waitUntil: (work: Promise<unknown>) => void;
  readonly log: Logger;
};

export function repoIndexRpc(deps: IndexRpcDeps): RepoIndexRpc {
  return {
    async repositoryStalk(repoId, viewer) {
      const record = await accessResult(deps.collaborators, await deps.registry.byId(repoId), {
        principal: viewerPrincipal(viewer),
        action: 'read',
        what: repoId,
      });
      if (!record.ok) return record;
      const stalk = await readStalk(deps.db, repoId);
      if (stalk.lines === null) catchUp(deps, record.value.engine_id);
      return { ok: true, value: stalk };
    },
    async repositoryGrowth(repoIds, viewer) {
      const ids = [...new Set(repoIds)].slice(0, MAX_GROWTH_IDS);
      const records = await deps.registry.byIds(ids);
      const principal = viewerPrincipal(viewer);
      const readable = (
        await Promise.all(
          records.map(async (record) => {
            const decision = await decideAccess(deps.collaborators, record, {
              principal,
              action: 'read',
            });
            return decision.verdict === 'allowed' ? record : null;
          }),
        )
      ).filter((record) => record !== null);
      const growth = await readGrowth(
        deps.db,
        readable.map((record) => record.id),
      );
      const engines = new Map(readable.map((record) => [record.id, record.engine_id]));
      for (const line of growth) if (!line.indexed) catchUp(deps, engines.get(line.repo_id) ?? '');
      return { ok: true, value: growth } satisfies RpcResult<typeof growth>;
    },
  };
}

function catchUp(deps: IndexRpcDeps, engineId: string): void {
  const engine = RunId.safeParse(engineId);
  if (!engine.success) return;
  deps.waitUntil(
    deps
      .engine(engine.data)
      .catchUpRepoEvents()
      .catch((error: unknown) => {
        deps.log.warn('repo events catch-up failed', { engine: engine.data, error });
      }),
  );
}
