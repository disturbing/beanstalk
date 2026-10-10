/**
 * Org secrets (doc 25 §3.4): encrypted at rest exactly like repository secrets
 * (`secret-box.ts`), with the org and the name as additional data under a different label, so
 * a repository row can never be replayed as an org row or the reverse. Each carries a
 * repository access policy and the "available to pre-land checks" toggle (D4, default off).
 * Values are write-only: listing returns names and policies; only a running job reads values.
 */
import { SecretName } from '@gitstalk/shared-race/actions';
import type {
  OrgSecretSummary,
  RepositoryAccessPolicy,
} from '@gitstalk/shared-race/actions-secrets';
import { z } from 'zod';

import {
  AccessColumn,
  deleteSelected,
  policyOf,
  replaceSelected,
  selectedRepos,
} from './org-access-rows';
import { SecretsNotConfiguredError } from './secrets';
import { KEY_VERSION, encodeText, importSecretsKey, openValue, sealValue } from './secret-box';

export type OrgSecretWrite = {
  readonly name: SecretName;
  /** Null keeps the stored value; the secret must exist. */
  readonly value: string | null;
  readonly access: RepositoryAccessPolicy;
  readonly prelandAllowed: boolean;
};

export type OrgSecretsStore = {
  list(orgId: string): Promise<OrgSecretSummary[]>;
  /** The saved summary, or null when `value` is null and there is nothing to keep. */
  put(
    orgId: string,
    secret: OrgSecretWrite,
    by: { readonly actor: string; readonly at: string },
  ): Promise<OrgSecretSummary | null>;
  delete(orgId: string, name: string): Promise<boolean>;
  /** Plain values of `names` that exist (for a running job only). */
  reveal(orgId: string, names: readonly string[]): Promise<Record<string, string>>;
};

const Row = z.object({
  name: z.string(),
  access: AccessColumn,
  preland_allowed: z.number(),
  updated_at: z.string(),
  updated_by: z.string(),
});
const SealedRow = z.object({ name: z.string(), ciphertext: z.string(), iv: z.string() });

/** The D1 store; `keyBase64` is `ACTIONS_SECRETS_KEY` (null: secrets are not configured). */
export function d1OrgSecrets(db: D1Database, keyBase64: string | null): OrgSecretsStore {
  const key = keyBase64 === null ? null : importSecretsKey(keyBase64);
  const requireKey = async (): Promise<CryptoKey> => {
    if (key === null) throw new SecretsNotConfiguredError();
    return key;
  };
  return {
    async list(orgId) {
      const [{ results }, selected] = await Promise.all([
        db
          .prepare(
            'SELECT name, access, preland_allowed, updated_at, updated_by FROM actions_org_secrets WHERE org_id = ? ORDER BY name',
          )
          .bind(orgId)
          .all(),
        selectedRepos(db, { orgId, kind: 'secret' }),
      ]);
      return results.map((raw) => {
        const row = Row.parse(raw);
        return summaryOf(row, policyOf(row.access, selected.get(row.name)));
      });
    },
    async put(orgId, secret, by) {
      const entry = { orgId, kind: 'secret', name: secret.name } as const;
      if (secret.value === null && !(await exists(db, orgId, secret.name))) return null;
      const write =
        secret.value === null
          ? keepValue(db, orgId, secret, by)
          : await replaceValue(db, {
              orgId,
              secret,
              value: secret.value,
              key: await requireKey(),
              by,
            });
      await db.batch([write, ...replaceSelected(db, entry, secret.access)]);
      return {
        name: secret.name,
        access: secret.access,
        prelandAllowed: secret.prelandAllowed,
        updatedAt: by.at,
        updatedBy: by.actor,
      };
    },
    async delete(orgId, name) {
      const upper = name.toUpperCase();
      const [removed] = await db.batch([
        db
          .prepare('DELETE FROM actions_org_secrets WHERE org_id = ? AND name = ?')
          .bind(orgId, upper),
        deleteSelected(db, { orgId, kind: 'secret', name: upper }),
      ]);
      return (removed?.meta.changes ?? 0) > 0;
    },
    async reveal(orgId, names) {
      if (names.length === 0) return {};
      const cryptoKey = await requireKey();
      const { results } = await db
        .prepare(
          `SELECT name, ciphertext, iv FROM actions_org_secrets WHERE org_id = ? AND name IN (${names.map(() => '?').join(', ')})`,
        )
        .bind(orgId, ...names)
        .all();
      const values = await Promise.all(
        results.map(async (raw) => {
          const row = SealedRow.parse(raw);
          return [row.name, await openValue(cryptoKey, orgAad(orgId, row.name), row)] as const;
        }),
      );
      return Object.fromEntries(values);
    },
  };
}

async function replaceValue(
  db: D1Database,
  input: {
    readonly orgId: string;
    readonly secret: OrgSecretWrite;
    readonly value: string;
    readonly key: CryptoKey;
    readonly by: { readonly actor: string; readonly at: string };
  },
): Promise<D1PreparedStatement> {
  const { orgId, secret, by } = input;
  const sealed = await sealValue(input.key, orgAad(orgId, secret.name), input.value);
  return db
    .prepare(
      `INSERT INTO actions_org_secrets (org_id, name, ciphertext, iv, key_version, access, preland_allowed, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(org_id, name) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv,
         key_version = excluded.key_version, access = excluded.access,
         preland_allowed = excluded.preland_allowed, updated_at = excluded.updated_at,
         updated_by = excluded.updated_by`,
    )
    .bind(
      orgId,
      secret.name,
      sealed.ciphertext,
      sealed.iv,
      KEY_VERSION,
      secret.access.kind,
      secret.prelandAllowed ? 1 : 0,
      by.at,
      by.actor,
    );
}

async function exists(db: D1Database, orgId: string, name: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS found FROM actions_org_secrets WHERE org_id = ? AND name = ?')
    .bind(orgId, name)
    .first();
  return row !== null;
}

function keepValue(
  db: D1Database,
  orgId: string,
  secret: OrgSecretWrite,
  by: { readonly actor: string; readonly at: string },
): D1PreparedStatement {
  return db
    .prepare(
      'UPDATE actions_org_secrets SET access = ?, preland_allowed = ?, updated_at = ?, updated_by = ? WHERE org_id = ? AND name = ?',
    )
    .bind(secret.access.kind, secret.prelandAllowed ? 1 : 0, by.at, by.actor, orgId, secret.name);
}

function summaryOf(row: z.infer<typeof Row>, access: RepositoryAccessPolicy): OrgSecretSummary {
  return {
    name: SecretName.parse(row.name),
    access,
    prelandAllowed: row.preland_allowed === 1,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

function orgAad(orgId: string, name: string): Uint8Array<ArrayBuffer> {
  return encodeText(`beanstalk-actions-org-secret\0${orgId}\0${name}`);
}
