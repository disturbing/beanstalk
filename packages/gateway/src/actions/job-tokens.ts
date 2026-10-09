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
  /** The automation the job runs (doc 25 §7.6); null for a GitHub workflow's job. */
  readonly automationId?: string | null;
};

/** A verified job token: the engine it reads (and maybe pushes) and the job it belongs to. */
export type VerifiedJobToken = {
  readonly engineId: string;
  readonly jobId: string;
  readonly canPush: boolean;
  /** Set for an automation's job: it pushes as `<id>[automation]` and owns its memory ref. */
  readonly automationId: string | null;
};

const Row = z.object({
  engine_id: z.string(),
  job_id: z.string(),
  can_push: z.number(),
  expires_ms: z.number(),
  revoked_ms: z.number().nullable(),
  automation_id: z.string().nullable(),
});

/** Mints a token for a job and records its hash. */
export async function mintJobToken(db: D1Database, grant: JobTokenGrant): Promise<string> {
  const token = `${JOB_TOKEN_PREFIX}${base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))}`;
  await db
    .prepare(
      `INSERT INTO actions_job_tokens (token_hash, repo_id, engine_id, run_id, job_id, can_push, expires_ms, automation_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      await tokenHash(token),
      grant.repoId,
      grant.engineId,
      grant.runId,
      grant.jobId,
      grant.canPush ? 1 : 0,
      grant.expiresMs,
      grant.automationId ?? null,
    )
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
      'SELECT engine_id, job_id, can_push, expires_ms, revoked_ms, automation_id FROM actions_job_tokens WHERE token_hash = ?',
    )
    .bind(await tokenHash(token))
    .first();
  const row = Row.safeParse(raw);
  if (!row.success || row.data.revoked_ms !== null || row.data.expires_ms <= nowMs) return null;
  return {
    engineId: row.data.engine_id,
    jobId: row.data.job_id,
    canPush: row.data.can_push === 1,
    automationId: row.data.automation_id,
  };
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

/** A running automation job, as its job token names it (the model proxy's check, doc 25 §7.5). */
export type AutomationJob = {
  readonly repoId: string;
  readonly runId: string;
  readonly jobId: string;
  readonly automationId: string;
};

const AutomationRow = z.object({
  repo_id: z.string(),
  run_id: z.string(),
  job_id: z.string(),
  automation_id: z.string().nullable(),
  expires_ms: z.number(),
  revoked_ms: z.number().nullable(),
});

/** The automation job a token belongs to; null for any other, expired or revoked token. */
export async function automationJobOf(
  db: D1Database,
  token: string,
  nowMs: number,
): Promise<AutomationJob | null> {
  if (!token.startsWith(JOB_TOKEN_PREFIX)) return null;
  const raw = await db
    .prepare(
      'SELECT repo_id, run_id, job_id, automation_id, expires_ms, revoked_ms FROM actions_job_tokens WHERE token_hash = ?',
    )
    .bind(await tokenHash(token))
    .first();
  const row = AutomationRow.safeParse(raw);
  if (!row.success) return null;
  const { automation_id: automationId, revoked_ms: revoked, expires_ms: expires } = row.data;
  if (automationId === null || revoked !== null || expires <= nowMs) return null;
  return { repoId: row.data.repo_id, runId: row.data.run_id, jobId: row.data.job_id, automationId };
}
