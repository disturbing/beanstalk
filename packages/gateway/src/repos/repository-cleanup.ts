/**
 * What a deleted repository leaves outside the registry's rows (doc 27 §10.8): its dependency
 * snapshots (the executor's R2 bucket and index, through `forgetRepository`), its Actions logs
 * in R2, and its Actions schedules (the repository's `ActionsRepoDO` alarm). Runs after the
 * registry rows are gone. A failure here never fails the delete: it is logged, and the 30-day
 * log expiry and the executor's daily sweep remove what stays.
 */
import type { ActionsExecutor } from '@gitstalk/shared-race/actions';
import type { RepositoryRecord } from '@gitstalk/shared-race/repos';

import { readActionsConfig } from '../actions/actions-config';
import type { Logger } from '../log';

export type RepositoryCleanupPorts = {
  /** The Actions executor, or null when Actions run on the built-in stub. */
  readonly executor: Pick<ActionsExecutor, 'forgetRepository'> | null;
  /** The repository's Actions object (schedules, queued stalk moves). */
  readonly actionsRepo: (repoId: string) => { forget(): Promise<void> };
  readonly actionsLogs: R2Bucket;
  readonly log: Logger;
};

export type RepositoryCleanup = (record: Pick<RepositoryRecord, 'id' | 'owner'>) => Promise<void>;

/** R2 deletes at most this many keys per call. */
const PAGE = 1000;

/** A cleanup that runs every part, logs each failure and never throws. */
export function repositoryCleanup(ports: RepositoryCleanupPorts): RepositoryCleanup {
  return async (record) => {
    const parts: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
      ['dependency cache', async () => forgetDeps(ports, record.id)],
      // Logs of runs from before a transfer sit under the earlier owner's id; the bucket's
      // 30-day expiry removes those.
      [
        'actions logs',
        async () => deletePrefix(ports.actionsLogs, `${record.owner.id}/${record.id}/`),
      ],
      ['actions schedules', async () => ports.actionsRepo(record.id).forget()],
    ];
    const results = await Promise.allSettled(parts.map(async ([, run]) => run()));
    results.forEach((result, index) => {
      const part = parts[index]?.[0] ?? 'unknown';
      if (result.status === 'rejected')
        ports.log.warn('repository cleanup failed; left for expiry or the sweep', {
          repo: record.id,
          part,
          error: result.reason,
        });
    });
  };
}

/** The ports from the gateway's bindings: the executor only in `service` mode. */
export function cleanupPortsFrom(env: Env, log: Logger): RepositoryCleanupPorts {
  const binding: unknown = Reflect.get(env, 'ACTIONS_EXECUTOR');
  const executor =
    readActionsConfig(env).executorMode === 'service' && isForgetter(binding) ? binding : null;
  return {
    executor,
    actionsRepo: (repoId) => env.ACTIONS_REPOS.getByName(repoId),
    actionsLogs: env.ACTIONS_LOGS,
    log,
  };
}

function isForgetter(value: unknown): value is Pick<ActionsExecutor, 'forgetRepository'> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'forgetRepository') === 'function'
  );
}

async function forgetDeps(ports: RepositoryCleanupPorts, repoId: string): Promise<void> {
  if (ports.executor === null) return;
  const outcome = await ports.executor.forgetRepository(repoId);
  if (!outcome.ok) throw new Error(`forgetRepository: ${outcome.error.message}`);
  if (!outcome.value.purged) throw new Error('the executor could not purge R2 yet');
  ports.log.info('dependency cache forgotten', {
    repo: repoId,
    objects_deleted: outcome.value.objectsDeleted,
  });
}

/** Deletes every object under `prefix`, a listing page at a time. */
export async function deletePrefix(bucket: R2Bucket, prefix: string): Promise<number> {
  let deleted = 0;
  let cursor: string | undefined = undefined;
  do {
    // oxlint-disable-next-line no-await-in-loop -- R2 listing pages follow each other
    const page: R2Objects = await bucket.list({
      prefix,
      limit: PAGE,
      ...(cursor === undefined ? {} : { cursor }),
    });
    const keys = page.objects.map((object) => object.key);
    // oxlint-disable-next-line no-await-in-loop -- delete this page before reading the next
    if (keys.length > 0) await bucket.delete(keys);
    deleted += keys.length;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor !== undefined);
  return deleted;
}
