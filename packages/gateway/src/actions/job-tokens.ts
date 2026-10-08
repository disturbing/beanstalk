/**
 * Job tokens (`bsj_…`, the job's `GITHUB_TOKEN`, doc 25 §3.5): minted per job by its run's
 * Durable Object, bound to one repository engine, alive for the job's timeout plus 5 minutes
 * and revoked when the job ends. Read always; push only `bean/*` and only when the job's
 * `permissions` give `contents: write` (pushes to the sprout, the stalk and `main` are refused
 * for every credential). Stored as SHA-256; the plain token exists only in the job.
 */
import { z } from 'zod';

import { base64UrlEncode } from '../auth/base64url';

export const JOB_TOKEN_PREFIX = 'bsj_';
/** A job token outlives its job's timeout by this much, then dies on its own. */
export const JOB_TOKEN_GRACE_MS = 5 * 60 * 1000;

export type JobTokenGrant = {
  readonly repoId: string;
  readonly engineId: string;
  readonly runId: string;
  readonly jobId: string;
  readonly canPush: boolean;
  readonly expiresMs: number;
};

/** A verified job token: the engine it reads (and maybe pushes) and the job it belongs to. */
export type VerifiedJobToken = {
  readonly engineId: string;
  readonly jobId: string;
  readonly canPush: boolean;
};

const Row = z.object({
  engine_id: z.string(),
  job_id: z.string(),
  can_push: z.number(),
  expires_ms: z.number(),
  revoked_ms: z.number().nullable(),
});

/** Mints a token for a job and records its hash. */
export async function mintJobToken(db: D1Database, grant: JobTokenGrant): Promise<string> {
  const token = `${JOB_TOKEN_PREFIX}${base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))}`;
  await db
    .prepare(
      `INSERT INTO actions_job_tokens (token_hash, repo_id, engine_id, run_id, job_id, can_push, expires_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(await tokenHash(token), grant.repoId, grant.engineId, grant.runId, grant.jobId, grant.canPush ? 1 : 0, grant.expiresMs)
    .run();
  return token;
}

/** The token's grant, or null when it is unknown, expired or revoked. */
export async function verifyJobToken(
  db: D1Database,
  token: string,
  nowMs: number,
): Promise<VerifiedJobToken | null> {
  if (!token.startsWith(JOB_TOKEN_PREFIX)) return null;
  const raw = await db
    .prepare(
      'SELECT engine_id, job_id, can_push, expires_ms, revoked_ms FROM actions_job_tokens WHERE token_hash = ?',
    )
    .bind(await tokenHash(token))
    .first();
  const row = Row.safeParse(raw);
  if (!row.success || row.data.revoked_ms !== null || row.data.expires_ms <= nowMs) return null;
  return { engineId: row.data.engine_id, jobId: row.data.job_id, canPush: row.data.can_push === 1 };
}

/** Revokes every token of a job (it ended, was cancelled or timed out). */
export async function revokeJobTokens(db: D1Database, jobId: string, nowMs: number): Promise<void> {
  await db
    .prepare('UPDATE actions_job_tokens SET revoked_ms = ? WHERE job_id = ? AND revoked_ms IS NULL')
    .bind(nowMs, jobId)
    .run();
}

/** SHA-256 of a secret token, hex. */
export async function tokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
