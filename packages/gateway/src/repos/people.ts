/**
 * People and credentials as the collaborators RPC needs them: a person by handle (to invite
 * them) and the names of the tokens and keys that acted on a repository (for its sessions
 * list). Reads the identity database (people, their tokens and keys) and the registry's
 * deploy tokens; never a secret.
 */
import type { IdentityEnv } from '@gitstalk/shared-identity/identity-env';
import type { SessionVia } from '@gitstalk/shared-race/collaborators';

import type { Person } from './collaborators';

export type CredentialRef = { readonly via: SessionVia; readonly id: string };

export type PeopleDirectory = {
  /** The person with this handle (any case), or null; disabled accounts are nobody. */
  byHandle(handle: string): Promise<Person | null>;
  /** Names of credentials by `<via>:<id>`; missing ones are left out. */
  credentialNames(refs: readonly CredentialRef[]): Promise<ReadonlyMap<string, string>>;
};

/** Which table names each kind of credential. Agent sessions are MCP clients' session tokens. */
const NAME_SOURCES: Readonly<
  Partial<Record<SessionVia, { db: 'identity' | 'forge'; sql: string }>>
> = {
  'personal-token': { db: 'identity', sql: 'SELECT id, name FROM user_tokens' },
  'agent-session': { db: 'identity', sql: 'SELECT id, name FROM user_tokens' },
  'ssh-key': { db: 'identity', sql: 'SELECT id, name FROM ssh_keys' },
  'deploy-token': { db: 'forge', sql: 'SELECT id, name FROM deploy_tokens' },
};

export function peopleDirectory(identity: IdentityEnv, forge: D1Database): PeopleDirectory {
  return {
    async byHandle(handle) {
      const row = await identity.IDENTITY_DB.prepare(
        'SELECT id, handle FROM users WHERE handle = ? AND disabled_at IS NULL',
      )
        .bind(handle)
        .first<{ id: string; handle: string }>();
      return row === null ? null : { id: row.id, handle: row.handle };
    },
    async credentialNames(refs) {
      const names = new Map<string, string>();
      const lookups = refs.flatMap((ref) => {
        const source = NAME_SOURCES[ref.via];
        return source === undefined ? [] : [{ ref, source }];
      });
      const found = await Promise.all(
        lookups.map(async ({ ref, source }) => {
          const db = source.db === 'identity' ? identity.IDENTITY_DB : forge;
          const row = await db
            .prepare(`${source.sql} WHERE id = ?`)
            .bind(ref.id)
            .first<{ id: string; name: string }>();
          return row === null ? null : ([`${ref.via}:${ref.id}`, row.name] as const);
        }),
      );
      for (const entry of found) if (entry !== null) names.set(entry[0], entry[1]);
      return names;
    },
  };
}
