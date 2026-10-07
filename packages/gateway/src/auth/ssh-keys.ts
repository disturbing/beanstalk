/**
 * SSH public keys people registered (Settings → SSH keys, or `/beanstalk:setup`), as git over
 * SSH asks about them. One adapter over `@beanstalk/shared-identity/ssh-keys` (`findUserByKey`,
 * `touchKey`), so the SSH path depends on this narrow shape only and tests can fake it.
 */
import type { IdentityEnv } from '@beanstalk/shared-identity/identity-env';
import type { Scope } from '@beanstalk/shared-identity/scopes';
import { findUserByKey, touchKey } from '@beanstalk/shared-identity/ssh-keys';

import type { GitScope, GitUser } from './git-credential';
import { gitScopes } from './git-credential';

/** A registered key and its owner. */
export type SshKeyOwner = {
  readonly user: GitUser;
  readonly scopes: readonly Scope[];
  readonly key: {
    readonly id: string;
    readonly fingerprint: string;
    readonly lastUsedAt: number | null;
  };
};

/** What the SSH path needs from the accounts store. */
export type SshKeyStore = {
  /** The owner of an OpenSSH public key line (`ssh-ed25519 AAAA…`), or null. */
  findUserByKey(publicKey: string): Promise<SshKeyOwner | null>;
  /** Records that the key was used (signature checked). */
  touchKey(key: SshKeyOwner['key']): Promise<void>;
};

/** The accounts store behind the identity database. */
export function sshKeyStore(env: IdentityEnv): SshKeyStore {
  return {
    async findUserByKey(publicKey) {
      const owner = await findUserByKey(env, { publicKey });
      if (owner === null) return null;
      return {
        user: { id: owner.user.id, handle: owner.user.handle },
        scopes: owner.scopes,
        key: {
          id: owner.key.id,
          fingerprint: owner.key.fingerprint,
          lastUsedAt: owner.key.lastUsedAt,
        },
      };
    },
    touchKey: (key) => touchKey(env, key),
  };
}

/** The git scopes a key carries (an account's keys read and push beans; never land). */
export function sshGitScopes(owner: SshKeyOwner): GitScope[] {
  return gitScopes(owner.scopes);
}
