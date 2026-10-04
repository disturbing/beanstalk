/**
 * RunIndex: one Durable Object (`runs`) that lists every run for the web app (`listRuns`).
 * Each RunDO upserts its row when its phase or task counts change; rows are validated when
 * read back.
 */
import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';

import type { RunListItem } from '@beanstalk/shared-race/rpc';
import { PolicyName } from '@beanstalk/shared-race/run-config';

/** The index's one instance. */
export const RUN_INDEX_NAME = 'runs';
/** Runs `listRuns` returns at most. */
export const MAX_LISTED_RUNS = 200;

const Count = z.number().int().min(0);

const StoredItem = z.object({
  run: z.string(),
  policy: PolicyName,
  phase: z.enum(['created', 'running', 'finishing', 'done']),
  aborted: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  agents: Count,
  tasks: z.object({
    total: Count,
    pending: Count,
    running: Count,
    queued: Count,
    testing: Count,
    rework: Count,
    landed: Count,
    green: Count,
    dropped: Count,
  }),
  spent_usd: z.number(),
});

export class RunIndex extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS runs (
         run TEXT PRIMARY KEY,
         created_at TEXT NOT NULL,
         body TEXT NOT NULL
       )`,
    );
  }

  /** Records a run's row (newest values win). */
  async upsert(item: RunListItem): Promise<void> {
    this.ctx.storage.sql.exec(
      `INSERT INTO runs (run, created_at, body) VALUES (?, ?, ?)
       ON CONFLICT(run) DO UPDATE SET body = excluded.body`,
      item.run,
      item.created_at,
      JSON.stringify(item),
    );
  }

  /** The newest runs first. */
  async list(limit: number): Promise<RunListItem[]> {
    const bounded = Math.max(1, Math.min(MAX_LISTED_RUNS, Math.trunc(limit)));
    const rows = this.ctx.storage.sql
      .exec<{ body: string }>('SELECT body FROM runs ORDER BY created_at DESC LIMIT ?', bounded)
      .toArray();
    return rows.flatMap((row) => {
      const parsed = StoredItem.safeParse(JSON.parse(row.body));
      return parsed.success ? [parsed.data] : [];
    });
  }
}
