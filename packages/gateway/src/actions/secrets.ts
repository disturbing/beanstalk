/**
 * Actions secrets (doc 25 §3.4): per repository, encrypted at rest with AES-256-GCM under the
 * Worker secret `ACTIONS_SECRETS_KEY` (32 random bytes, base64), each value bound to its
 * repository and name as additional data so a row copied elsewhere does not decrypt. Values
 * are write-only: listing returns names; only a running job that names a secret reads it.
 *
 * D4 (`secretsForRun`): runs on the stalk, by dispatch and by schedule get the secrets their
 * jobs name; a pre-land run of a bean pushed by an agent session, a deploy token or a
 * collaborator who is not a maintainer gets none, except the secrets whose "available to
 * pre-land checks" toggle (`prelandAllowed`, default off) is on.
 */
import type { SecretSummary } from '@beanstalk/shared-race/actions';
import { SecretName } from '@beanstalk/shared-race/actions';
import { z } from 'zod';

import { KEY_VERSION, encodeText, importSecretsKey, openValue, sealValue } from './secret-box';

/** Where a run comes from, as far as secrets are concerned. */
export type RunOrigin =
  | { readonly kind: 'stalk' | 'dispatch' | 'schedule' }
  | {
      readonly kind: 'preland';
      /** A maintainer's own bean gets every secret; anyone else's only the toggled ones. */
      readonly pushedBy: 'maintainer' | 'collaborator' | 'agent-session' | 'deploy-token';
    };

/** The secrets a job may read: those it names that exist, filtered by D4. */
export function secretsForRun(
  origin: RunOrigin,
  named: readonly string[],
  stored: readonly { readonly name: string; readonly prelandAllowed: boolean }[],
): string[] {
  const wanted = new Set(named);
  return stored
    .filter((secret) => wanted.has(secret.name))
    .filter(
      (secret) =>
        origin.kind !== 'preland' || origin.pushedBy === 'maintainer' || secret.prelandAllowed,
    )
    .map((secret) => secret.name)
    .toSorted();
}

export type SecretsStore = {
  list(repoId: string): Promise<SecretSummary[]>;
  put(
    repoId: string,
    secret: { readonly name: string; readonly value: string; readonly prelandAllowed: boolean },
    by: { readonly actor: string; readonly at: string },
  ): Promise<SecretSummary>;
  delete(repoId: string, name: string): Promise<boolean>;
  /** Plain values of `names` that exist (for the running job only). */
  reveal(repoId: string, names: readonly string[]): Promise<Record<string, string>>;
};

const Row = z.object({
  name: z.string(),
  preland_allowed: z.number(),
  updated_at: z.string(),
  updated_by: z.string(),
});
const SealedRow = z.object({ name: z.string(), ciphertext: z.string(), iv: z.string() });

/** The D1 store; `keyBase64` is `ACTIONS_SECRETS_KEY` (null: secrets are not configured). */
export function d1Secrets(db: D1Database, keyBase64: string | null): SecretsStore {
  const key = keyBase64 === null ? null : importSecretsKey(keyBase64);
  const requireKey = async (): Promise<CryptoKey> => {
    if (key === null) throw new SecretsNotConfiguredError();
    return key;
  };
  return {
    async list(repoId) {
      const { results } = await db
        .prepare(
          'SELECT name, preland_allowed, updated_at, updated_by FROM actions_secrets WHERE repo_id = ? ORDER BY name',
        )
        .bind(repoId)
        .all();
      return results.map((row) => summaryOf(Row.parse(row)));
    },
    async put(repoId, secret, by) {
      const name = SecretName.parse(secret.name);
      const sealed = await sealValue(await requireKey(), aad(repoId, name), secret.value);
      await db
        .prepare(
          `INSERT INTO actions_secrets (repo_id, name, ciphertext, iv, key_version, preland_allowed, updated_at, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(repo_id, name) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv,
             key_version = excluded.key_version, preland_allowed = excluded.preland_allowed,
             updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
        )
        .bind(
          repoId,
          name,
          sealed.ciphertext,
          sealed.iv,
          KEY_VERSION,
          secret.prelandAllowed ? 1 : 0,
          by.at,
          by.actor,
        )
        .run();
      return { name, prelandAllowed: secret.prelandAllowed, updatedAt: by.at, updatedBy: by.actor };
    },
    async delete(repoId, name) {
      const result = await db
        .prepare('DELETE FROM actions_secrets WHERE repo_id = ? AND name = ?')
        .bind(repoId, name.toUpperCase())
        .run();
      return result.meta.changes > 0;
    },
    async reveal(repoId, names) {
      if (names.length === 0) return {};
      const cryptoKey = await requireKey();
      const { results } = await db
        .prepare(
          `SELECT name, ciphertext, iv FROM actions_secrets WHERE repo_id = ? AND name IN (${names.map(() => '?').join(', ')})`,
        )
        .bind(repoId, ...names)
        .all();
      const values = await Promise.all(
        results.map(async (raw) => {
          const row = SealedRow.parse(raw);
          return [row.name, await openValue(cryptoKey, aad(repoId, row.name), row)] as const;
        }),
      );
      return Object.fromEntries(values);
    },
  };
}

/** Secrets were asked for but `ACTIONS_SECRETS_KEY` is not set (a deployment fault). */
export class SecretsNotConfiguredError extends Error {
  constructor() {
    super('Actions secrets are not configured: set the ACTIONS_SECRETS_KEY Worker secret');
    this.name = 'SecretsNotConfiguredError';
  }
}

function summaryOf(row: z.infer<typeof Row>): SecretSummary {
  return {
    name: SecretName.parse(row.name),
    prelandAllowed: row.preland_allowed === 1,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

function aad(repoId: string, name: string): Uint8Array<ArrayBuffer> {
  return encodeText(`beanstalk-actions-secret\0${repoId}\0${name}`);
}
