import { env, runInDurableObject } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import type { RepositoryForgotten } from '@beanstalk/shared-race/actions';
import type { RpcResult } from '@beanstalk/shared-race/rpc';

import { createLogger } from '../src/log';
import { deletePrefix, repositoryCleanup } from '../src/repos/repository-cleanup';
import type { RepositoryCleanupPorts } from '../src/repos/repository-cleanup';

/**
 * Deleting a repository removes what it left outside the registry (doc 27 §10.8): the executor
 * forgets its dependency cache, its Actions logs go from R2, its Actions object stops its
 * schedules, and its Actions rows go with the registry's. A part that fails is logged and
 * never fails the delete.
 */
const gateway = exports.default;
const log = createLogger('error');

function value<T>(result: RpcResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

function record() {
  const id = `r${crypto.randomUUID().replaceAll('-', '').slice(0, 11)}`;
  return { id, owner: { id: `u_${crypto.randomUUID().slice(0, 8)}`, handle: 'someone' } };
}

async function putLogs(ownerId: string, repoId: string, count: number): Promise<void> {
  await Promise.all(
    Array.from({ length: count }, async (_, index) =>
      env.ACTIONS_LOGS.put(
        `${ownerId}/${repoId}/run/job/${String(index).padStart(10, '0')}.log.gz`,
        'x',
      ),
    ),
  );
}

async function logKeys(ownerId: string, repoId: string): Promise<number> {
  return (await env.ACTIONS_LOGS.list({ prefix: `${ownerId}/${repoId}/` })).objects.length;
}

function ports(overrides: Partial<RepositoryCleanupPorts> = {}): {
  readonly ports: RepositoryCleanupPorts;
  readonly forgotten: string[];
  readonly actionsForgotten: string[];
} {
  const forgotten: string[] = [];
  const actionsForgotten: string[] = [];
  const answer: RpcResult<RepositoryForgotten> = {
    ok: true,
    value: { purged: true, objectsDeleted: 6 },
  };
  return {
    forgotten,
    actionsForgotten,
    ports: {
      executor: {
        forgetRepository: async (repoId) => {
          forgotten.push(repoId);
          return answer;
        },
      },
      actionsRepo: (repoId) => ({
        forget: async () => {
          actionsForgotten.push(repoId);
        },
      }),
      actionsLogs: env.ACTIONS_LOGS,
      log,
      ...overrides,
    },
  };
}

describe('repository cleanup', () => {
  it('forgets the dependency cache, deletes the Actions logs and stops the schedules', async () => {
    const gone = record();
    const kept = record();
    await putLogs(gone.owner.id, gone.id, 3);
    await putLogs(kept.owner.id, kept.id, 2);
    const fake = ports();

    await repositoryCleanup(fake.ports)(gone);

    expect(fake.forgotten).toEqual([gone.id]);
    expect(fake.actionsForgotten).toEqual([gone.id]);
    expect(await logKeys(gone.owner.id, gone.id)).toBe(0);
    expect(await logKeys(kept.owner.id, kept.id)).toBe(2);
  });

  it('never throws when the executor fails or cannot purge, and still does the rest', async () => {
    const throwing = record();
    await putLogs(throwing.owner.id, throwing.id, 1);
    const failing = ports({
      executor: {
        forgetRepository: async () => {
          throw new Error('executor unreachable');
        },
      },
    });
    await expect(repositoryCleanup(failing.ports)(throwing)).resolves.toBeUndefined();
    expect(failing.actionsForgotten).toEqual([throwing.id]);
    expect(await logKeys(throwing.owner.id, throwing.id)).toBe(0);

    const unpurged = ports({
      executor: {
        forgetRepository: async () => ({ ok: true, value: { purged: false, objectsDeleted: 0 } }),
      },
    });
    await expect(repositoryCleanup(unpurged.ports)(record())).resolves.toBeUndefined();
  });

  it('skips the executor on the stub executor', async () => {
    const fake = ports({ executor: null });
    const repo = record();
    await repositoryCleanup(fake.ports)(repo);
    expect(fake.actionsForgotten).toEqual([repo.id]);
  });

  it('deletes more than one listing page of logs', async () => {
    const repo = record();
    await putLogs(repo.owner.id, repo.id, 1003);
    expect(await deletePrefix(env.ACTIONS_LOGS, `${repo.owner.id}/${repo.id}/`)).toBe(1003);
    expect(await logKeys(repo.owner.id, repo.id)).toBe(0);
  });
});

describe('deleting a repository through the gateway', () => {
  it('removes its Actions rows, logs and schedules alarm', async () => {
    const coop = { id: `u_cleanup_${crypto.randomUUID().slice(0, 8)}`, handle: 'cleanup1' };
    const repo = value(
      await gateway.createRepository(coop, {
        name: 'leaves-nothing',
        visibility: 'private',
        start: { kind: 'empty' },
      }),
    );
    const now = new Date().toISOString();
    await env.FORGE.batch([
      env.FORGE.prepare(
        `INSERT INTO actions_secrets (repo_id, name, ciphertext, iv, key_version, updated_at, updated_by)
         VALUES (?, 'TOKEN', 'c', 'i', 1, ?, ?)`,
      ).bind(repo.id, now, coop.id),
      env.FORGE.prepare(
        `INSERT INTO actions_variables (repo_id, name, value, updated_at, updated_by)
         VALUES (?, 'MODE', 'on', ?, ?)`,
      ).bind(repo.id, now, coop.id),
    ]);
    await putLogs(coop.id, repo.id, 2);
    const actionsRepo = env.ACTIONS_REPOS.getByName(repo.id);
    await runInDurableObject(actionsRepo, async (_, state) => {
      await state.storage.setAlarm(Date.now() + 60_000);
    });

    value(await gateway.deleteRepository(coop.id, repo.id));

    const counts = await Promise.all(
      ['actions_secrets', 'actions_variables'].map(async (table) =>
        env.FORGE.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE repo_id = ?`)
          .bind(repo.id)
          .first<{ n: number }>(),
      ),
    );
    expect(counts.map((row) => row?.n)).toEqual([0, 0]);
    expect(await logKeys(coop.id, repo.id)).toBe(0);
    const alarm = await runInDurableObject(actionsRepo, async (_, state) =>
      state.storage.getAlarm(),
    );
    expect(alarm).toBeNull();
  });
});

describe('the executor asking whether a repository exists', () => {
  it('answers from the registry', async () => {
    const coop = { id: `u_exists_${crypto.randomUUID().slice(0, 8)}`, handle: 'exists1' };
    const repo = value(
      await gateway.createRepository(coop, {
        name: 'here',
        visibility: 'private',
        start: { kind: 'empty' },
      }),
    );
    const sink = exports.ActionsJobs;
    expect(await sink.repositoryExists(repo.id)).toEqual({ ok: true, value: { exists: true } });
    value(await gateway.deleteRepository(coop.id, repo.id));
    expect(await sink.repositoryExists(repo.id)).toEqual({ ok: true, value: { exists: false } });
  });
});
