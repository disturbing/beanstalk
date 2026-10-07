/**
 * Deploy tokens (`bsd_…`): one repository, read or read and write, an expiry, made by the
 * repository's owner (Settings, or the start page's Env vars tab) for CI and other machines.
 * Stored hashed in FORGE beside the registry, so a token dies with its repository and follows
 * it through a rename (it names the repository's id, not its name). `verifyDeployToken` is
 * what `verifyGitCredential` asks.
 */
import {
  hashSecret,
  isSameSecret,
  randomId,
  randomSecret,
} from '@beanstalk/shared-identity/secrets';
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

export const DEPLOY_TOKEN_PREFIX = 'bsd_';
const TOKEN_SHAPE = /^bsd_[A-Za-z0-9_-]{43}$/;
const DAY_MS = 24 * 3600 * 1000;
const TOUCH_AFTER_MS = 60_000;

/** What a valid deploy token opens. */
export type VerifiedDeployToken = {
  readonly id: string;
  readonly repoId: string;
  readonly engineId: string;
  readonly access: DeployTokenAccess;
  readonly createdBy: { readonly id: string; readonly handle: string };
};

/** The deploy token a git request presented, or null (malformed, unknown, expired, revoked, repository gone). */
export async function verifyDeployToken(
  db: D1Database,
  token: string,
  use: { readonly now: number; readonly from: string | null },
): Promise<VerifiedDeployToken | null> {
  if (!TOKEN_SHAPE.test(token)) return null;
  const tokenHash = await hashSecret(token);
  const row = await db
    .prepare(
      `SELECT t.id, t.token_hash, t.repo_id, t.access, t.created_by_id, t.created_by_handle,
              t.last_used_at, r.engine_id
         FROM deploy_tokens t JOIN repositories r ON r.id = t.repo_id
        WHERE t.token_hash = ? AND t.revoked_at IS NULL AND t.expires_at > ? AND r.state = 'ready'`,
    )
    .bind(tokenHash, use.now)
    .first<VerifyRow>();
  if (row === null || !(await isSameSecret(row.token_hash, tokenHash))) return null;
  if (row.last_used_at === null || use.now - row.last_used_at > TOUCH_AFTER_MS)
    await db
      .prepare('UPDATE deploy_tokens SET last_used_at = ?, last_used_from = ? WHERE id = ?')
      .bind(use.now, use.from, row.id)
      .run();
  return {
    id: row.id,
    repoId: row.repo_id,
    engineId: row.engine_id,
    access: row.access,
    createdBy: { id: row.created_by_id, handle: row.created_by_handle },
  };
}

/** The RPC the web app calls; every method checks that the actor owns the repository. */
export function deployTokensRpc(deps: {
  readonly db: D1Database;
  readonly now: () => number;
}): DeployTokensRpc {
  const { db, now } = deps;
  return {
    async createDeployToken(actor, repoId, input) {
      const parsed = CreateInputSchema.safeParse(input);
      if (!parsed.success)
        return failure(
          400,
          'invalid_request',
          parsed.error.issues[0]?.message ?? 'invalid token request',
        );
      if (!(await isOwner(db, actor, repoId)))
        return failure(404, 'not_found', 'no such repository');
      return {
        ok: true,
        value: await create(db, { actor, repoId, input: parsed.data, now: now() }),
      };
    },
    async listDeployTokens(actor, repoId) {
      if (!(await isOwner(db, actor, repoId)))
        return failure(404, 'not_found', 'no such repository');
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
      if (!(await isOwner(db, actor, repoId)))
        return failure(404, 'not_found', 'no such repository');
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

/** "US · git/2.53.0": where a token was last used, coarse enough to keep. */
export function usedFrom(request: Request): string {
  const cf: unknown = Reflect.get(request, 'cf');
  const country: unknown =
    typeof cf === 'object' && cf !== null ? Reflect.get(cf, 'country') : null;
  const agent = (request.headers.get('user-agent') ?? 'unknown client').split(' ')[0] ?? '';
  return `${typeof country === 'string' ? country : '??'} · ${agent.slice(0, 40)}`;
}

async function create(
  db: D1Database,
  input: {
    readonly actor: DeployTokenActor;
    readonly repoId: string;
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
      input.repoId,
      input.actor.id,
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

async function isOwner(db: D1Database, actor: DeployTokenActor, repoId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS yes FROM repositories WHERE id = ? AND owner_id = ? AND state = 'ready'")
    .bind(repoId, actor.id)
    .first<{ readonly yes: number }>();
  return row !== null;
}

function failure<T>(status: number, code: string, message: string): RpcResult<T> {
  return { ok: false, error: { code, status, message } };
}

type VerifyRow = {
  readonly id: string;
  readonly token_hash: string;
  readonly repo_id: string;
  readonly access: DeployTokenAccess;
  readonly created_by_id: string;
  readonly created_by_handle: string;
  readonly last_used_at: number | null;
  readonly engine_id: string;
};

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
