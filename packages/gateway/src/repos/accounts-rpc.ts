/**
 * `AccountsRpc`: the registry's half of a handle change and of closing an account. Rows keep
 * the person's id as the key; the handle columns are what addresses (`/<owner>/<repo>`),
 * member lists and pending invitations show, so a rename moves them in one batch. History
 * (activity, the access log, deploy-token creators) keeps the handle it was written with.
 */
import type { AccountsRpc } from '@beanstalk/shared-race/accounts';
import type { RpcResult } from '@beanstalk/shared-race/rpc';
import { RepoOwner } from '@beanstalk/shared-race/repos';

import type { Logger } from '../log';
import type { RepoEnginePort } from './engine-port';
import type { Registry } from './registry';
import type { RepositoryCleanup } from './repository-cleanup';
import type { RepositoryStorage } from '../adapters/repository-storage';

export type AccountsDeps = {
  readonly db: D1Database;
  readonly registry: Registry;
  readonly engine: RepoEnginePort;
  readonly storage: RepositoryStorage;
  /** What a deleted repository leaves outside the registry; never throws. */
  readonly cleanup: RepositoryCleanup;
  readonly log: Logger;
};

export function accountsRpc(deps: AccountsDeps): AccountsRpc {
  return {
    renameOwner: (userId, handle) => renameOwner(deps, userId, handle),
    closeAccount: (userId) => closeAccount(deps, userId),
  };
}

async function renameOwner(
  deps: AccountsDeps,
  userId: string,
  handle: string,
): Promise<RpcResult<{ readonly repositories: number }>> {
  const owner = RepoOwner.safeParse({ id: userId, handle });
  if (!owner.success)
    return {
      ok: false,
      error: { code: 'invalid_request', status: 400, message: 'not a user id and handle' },
    };
  const { db } = deps;
  const [repositories] = await db.batch([
    db.prepare('UPDATE repositories SET owner_handle = ? WHERE owner_id = ?').bind(handle, userId),
    // Old addresses of repositories that left this person (renamed or moved) follow the new
    // handle too, so `/<new>/<old-name>` resolves; `/<old>/<old-name>` resolves through the
    // retired handle (`Registry.resolve`). OR IGNORE: an address already taken there wins.
    db
      .prepare('UPDATE OR IGNORE repository_redirects SET owner_handle = ? WHERE owner_id = ?')
      .bind(handle, userId),
    db
      .prepare('UPDATE repository_members SET user_handle = ? WHERE user_id = ?')
      .bind(handle, userId),
    db
      .prepare('UPDATE repository_sessions SET user_handle = ? WHERE user_id = ?')
      .bind(handle, userId),
    db
      .prepare('UPDATE repository_invitations SET invitee_handle = ? WHERE invitee_id = ?')
      .bind(handle, userId),
    db
      .prepare('UPDATE repository_invitations SET invited_by_handle = ? WHERE invited_by_id = ?')
      .bind(handle, userId),
  ]);
  const moved = repositories?.meta.changes ?? 0;
  deps.log.info('owner renamed', { repositories: moved });
  return { ok: true, value: { repositories: moved } };
}

async function closeAccount(
  deps: AccountsDeps,
  userId: string,
): Promise<RpcResult<{ readonly deletedRepositories: readonly string[] }>> {
  const [active, archived] = await Promise.all([
    deps.registry.byOwner(userId, 'active'),
    deps.registry.byOwner(userId, 'archived'),
  ]);
  const owned = [...active, ...archived];
  // One at a time, as Settings deletes one: the engine stops before its storage goes.
  for (const record of owned) {
    // oxlint-disable-next-line no-await-in-loop -- each repository is removed whole before the next
    await deps.registry.remove(record.id);
    // oxlint-disable-next-line no-await-in-loop -- see above
    await deps.engine.close(record.engine_id);
    // oxlint-disable-next-line no-await-in-loop -- see above
    await deps.storage.delete(record.artifacts_repo);
    // oxlint-disable-next-line no-await-in-loop -- see above
    await deps.cleanup(record);
  }
  const { db } = deps;
  await db.batch([
    db.prepare('DELETE FROM repository_members WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM repository_invitations WHERE invitee_id = ?').bind(userId),
    db.prepare('DELETE FROM repository_invitations WHERE invited_by_id = ?').bind(userId),
  ]);
  deps.log.info('account closed', { repositories: owned.length });
  return { ok: true, value: { deletedRepositories: owned.map((record) => record.id) } };
}
