/**
 * Deploy tokens (`bsd_…`): one repository, read or read and write, an expiry, made by the
 * repository's owner or a maintainer (Settings, or the start page's Env vars tab) for CI and
 * other machines, and independent of collaborators afterwards (removing its maker leaves it).
 * Stored hashed in FORGE beside the registry, so a token dies with its repository and follows
 * it through a rename (it names the repository's id, not its name). `verifyDeployToken` is
 * what `verifyGitCredential` asks; the web's RPC is `deploy-tokens-rpc.ts`.
 */
import { hashSecret, isSameSecret } from '@beanstalk/shared-identity/secrets';
import type { DeployTokenAccess } from '@beanstalk/shared-race/deploy-tokens';

export const DEPLOY_TOKEN_PREFIX = 'bsd_';
const TOKEN_SHAPE = /^bsd_[A-Za-z0-9_-]{43}$/;
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

/** "US · git/2.53.0": where a token was last used, coarse enough to keep. */
export function usedFrom(request: Request): string {
  const cf: unknown = Reflect.get(request, 'cf');
  const country: unknown =
    typeof cf === 'object' && cf !== null ? Reflect.get(cf, 'country') : null;
  const agent = (request.headers.get('user-agent') ?? 'unknown client').split(' ')[0] ?? '';
  return `${typeof country === 'string' ? country : '??'} · ${agent.slice(0, 40)}`;
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
