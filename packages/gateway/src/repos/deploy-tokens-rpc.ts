/**
 * The deploy tokens RPC the web app calls (Settings, the start page's Env vars tab): create,
 * list and revoke. Each is allowed when `mayUseEngine` lets the actor manage the repository's
 * deploy tokens (its owner and maintainers). Verifying a presented token is `deploy-tokens.ts`.
 */
import { hashSecret, randomId, randomSecret } from '@beanstalk/shared-identity/secrets';
import type {
  CreateDeployTokenInput,
  DeployTokenAccess,
  DeployTokenActor,
  DeployTokenSummary,
  DeployTokensRpc,
  IssuedDeployToken,
} from '@beanstalk/shared-race/deploy-tokens';
import { CreateDeployTokenInput as CreateInputSchema } from '@beanstalk/shared-race/deploy-tokens';
import type { RpcResult } from '@beanstalk/shared-race/rpc';

import { accessResult } from './access';
import type { CollaboratorStore } from './collaborators';
import { DEPLOY_TOKEN_PREFIX } from './deploy-tokens';
import type { Registry } from './registry';

const DAY_MS = 24 * 3600 * 1000;

export type DeployTokensDeps = {
  readonly db: D1Database;
  readonly now: () => number;
  readonly registry: Registry;
  readonly collaborators: CollaboratorStore;
};

export function deployTokensRpc(deps: DeployTokensDeps): DeployTokensRpc {
  const { db, now } = deps;
  const manageable = async (actor: DeployTokenActor, repoId: string) =>
    accessResult(deps.collaborators, await deps.registry.byId(repoId), {
      principal: { kind: 'person', user: actor },
      action: 'deploy-tokens',
      what: repoId,
    });
  return {
    async createDeployToken(actor, repoId, input) {
      const parsed = CreateInputSchema.safeParse(input);
      if (!parsed.success)
        return failure(
          400,
          'invalid_request',
          parsed.error.issues[0]?.message ?? 'invalid token request',
        );
      const repo = await manageable(actor, repoId);
      if (!repo.ok) return repo;
      return {
        ok: true,
        value: await create(db, {
          actor,
          repo: { id: repoId, ownerId: repo.value.owner.id },
          input: parsed.data,
          now: now(),
        }),
      };
    },
    async listDeployTokens(actor, repoId) {
      const repo = await manageable(actor, repoId);
      if (!repo.ok) return repo;
      const { results } = await db
        .prepare(
          `SELECT * FROM deploy_tokens WHERE repo_id = ? AND COALESCE(revoked_at, expires_at) > ?
            ORDER BY created_at DESC LIMIT 100`,
        )
        .bind(repoId, now() - 7 * DAY_MS)
        .all<TokenRow>();
      return { ok: true, value: results.map(toSummary) };
    },
    async revokeDeployToken(actor, repoId, tokenId) {
      const repo = await manageable(actor, repoId);
      if (!repo.ok) return repo;
      const result = await db
        .prepare(
          'UPDATE deploy_tokens SET revoked_at = ? WHERE id = ? AND repo_id = ? AND revoked_at IS NULL',
        )
        .bind(now(), tokenId, repoId)
        .run();
      return { ok: true, value: { revoked: result.meta.changes > 0 } };
    },
  };
}

async function create(
  db: D1Database,
  input: {
    readonly actor: DeployTokenActor;
    readonly repo: { readonly id: string; readonly ownerId: string };
    readonly input: CreateDeployTokenInput;
    readonly now: number;
  },
): Promise<IssuedDeployToken> {
  const token = `${DEPLOY_TOKEN_PREFIX}${randomSecret()}`;
  const summary: DeployTokenSummary = {
    id: randomId('dtok'),
    name: input.input.name,
    access: input.input.access,
    hint: `${DEPLOY_TOKEN_PREFIX}…${token.slice(-4)}`,
    createdByHandle: input.actor.handle,
    createdAt: input.now,
    expiresAt: input.now + input.input.days * DAY_MS,
    lastUsedAt: null,
    lastUsedFrom: null,
    revokedAt: null,
  };
  await db
    .prepare(
      `INSERT INTO deploy_tokens (id, token_hash, repo_id, owner_id, created_by_id, created_by_handle,
         name, access, hint, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      summary.id,
      await hashSecret(token),
      input.repo.id,
      input.repo.ownerId,
      input.actor.id,
      input.actor.handle,
      summary.name,
      summary.access,
      summary.hint,
      summary.createdAt,
      summary.expiresAt,
    )
    .run();
  return { token, summary };
}

function failure<T>(status: number, code: string, message: string): RpcResult<T> {
  return { ok: false, error: { code, status, message } };
}

type TokenRow = {
  readonly id: string;
  readonly name: string;
  readonly access: DeployTokenAccess;
  readonly hint: string;
  readonly created_by_handle: string;
  readonly created_at: number;
  readonly expires_at: number;
  readonly last_used_at: number | null;
  readonly last_used_from: string | null;
  readonly revoked_at: number | null;
};

function toSummary(row: TokenRow): DeployTokenSummary {
  return {
    id: row.id,
    name: row.name,
    access: row.access,
    hint: row.hint,
    createdByHandle: row.created_by_handle,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    lastUsedFrom: row.last_used_from,
    revokedAt: row.revoked_at,
  };
}
