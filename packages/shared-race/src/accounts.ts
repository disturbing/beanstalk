/**
 * What the gateway does when an account changes (`docs/claude-opus/29-settings.md`). The
 * registry stores owners and collaborators by id and, for addresses and lists, by handle; a
 * handle change moves those, and closing an account deletes the person's repositories and
 * their places on everyone else's. The web app calls these after accounts (D1 identity) has
 * accepted the change, with the person it authenticated.
 */
import type { RpcResult } from './rpc';

export type AccountsRpc = {
  /** Every row naming the person by handle now names `handle`; answers how many repositories moved. */
  renameOwner(
    userId: string,
    handle: string,
  ): Promise<RpcResult<{ readonly repositories: number }>>;
  /**
   * Deletes the person's own repositories (active and archived: storage, engine, registry)
   * and removes them from every other repository (memberships, invitations). Answers the
   * deleted repositories' ids, so their pictures can be removed too.
   */
  closeAccount(
    userId: string,
  ): Promise<RpcResult<{ readonly deletedRepositories: readonly string[] }>>;
};

export function isAccountsRpc(binding: unknown): binding is AccountsRpc {
  return (
    typeof binding === 'object' &&
    binding !== null &&
    typeof Reflect.get(binding, 'renameOwner') === 'function' &&
    typeof Reflect.get(binding, 'closeAccount') === 'function'
  );
}
