/**
 * RunIndex: one Durable Object (`runs`) that lists every run for the web app (`listRuns`).
 * Each RunDO upserts its row when its phase or task counts change; rows are validated when
 * read back.
 *
 * It also holds the gateway-wide spend guards: the kill switch (`halt`: no new runs, every
 * run in flight stopped) and the hourly sweep that deletes the Artifacts repos of any run
 * that began more than a day ago, and of orphaned `race-*` repos, so nothing outlives a day
 * even when a run's own reap failed or it kept its repo.
 */
import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';

import { RunId } from '@gitstalk/shared-race/ids';
import type { RunListItem } from '@gitstalk/shared-race/rpc';
import { PolicyName, RunPreset } from '@gitstalk/shared-race/run-config';

import { artifactsPort } from '../adapters/artifacts';
import { readConfig } from '../config';
import type { Logger } from '../log';
import { createLogger } from '../log';
import { runOfRepo } from './run-names';

/** The index's one instance. */
export const RUN_INDEX_NAME = 'runs';
/** Runs `listRuns` returns at most. */
export const MAX_LISTED_RUNS = 200;
/** How often the sweep runs while run repos remain. */
export const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
/** Repos of runs that began longer ago than this are deleted by the sweep. */
export const REPO_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** RunDOs a sweep or a halt calls at once. */
const RUN_CALL_CONCURRENCY = 4;
const HALT_KEY = 'halt';

const Count = z.number().int().min(0);

const StoredItem = z.object({
  run: z.string(),
  policy: PolicyName,
  preset: RunPreset.nullable().default(null),
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
    // Rows written before parking have none.
    parked: Count.default(0),
  }),
  spent_usd: z.number(),
});

/** The kill switch, when on. */
export type Halt = { readonly reason: string; readonly at: string };

export type HaltReport = Halt & { readonly stopped: readonly string[] };

export type SweepReport = {
  readonly runs: number;
  readonly deleted: readonly string[];
  readonly skipped: readonly string[];
  readonly failed: readonly { readonly run: string; readonly error: string }[];
};

export class RunIndex extends DurableObject<Env> {
  readonly #log: Logger;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#log = createLogger(readConfig(env).logLevel, { component: 'run-index' });
    ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS runs (
         run TEXT PRIMARY KEY,
         created_at TEXT NOT NULL,
         body TEXT NOT NULL
       )`,
    );
  }

  /** Records a run's row (newest values win) and makes sure the sweep is scheduled. */
  async upsert(item: RunListItem): Promise<void> {
    this.ctx.storage.sql.exec(
      `INSERT INTO runs (run, created_at, body) VALUES (?, ?, ?)
       ON CONFLICT(run) DO UPDATE SET body = excluded.body`,
      item.run,
      item.created_at,
      JSON.stringify(item),
    );
    if ((await this.ctx.storage.getAlarm()) === null)
      await this.ctx.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
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

  /** The kill switch's state: null when runs may be created. */
  async halted(): Promise<Halt | null> {
    return this.ctx.storage.kv.get<Halt>(HALT_KEY) ?? null;
  }

  /** Turns the kill switch on: refuses new runs and stops every run not yet done. */
  async halt(reason: string): Promise<HaltReport> {
    const halt: Halt = { reason, at: new Date().toISOString() };
    this.ctx.storage.kv.put(HALT_KEY, halt);
    const open = this.ctx.storage.sql
      .exec<{ run: string }>(
        `SELECT run FROM runs WHERE json_extract(body, '$.phase') IN ('created', 'running')`,
      )
      .toArray()
      .flatMap((row) => {
        const run = RunId.safeParse(row.run);
        return run.success ? [run.data] : [];
      });
    const stopped = await inBatches(open, async (run) => {
      const result = await this.env.RUNS.getByName(run).stop(`halted: ${reason}`);
      return result.ok ? [run] : [];
    });
    this.#log.warn('runs halted', { reason, stopped: stopped.length });
    return { ...halt, stopped };
  }

  /** Turns the kill switch off. */
  async resume(): Promise<void> {
    this.ctx.storage.kv.delete(HALT_KEY);
    this.#log.info('runs resumed');
  }

  override async alarm(): Promise<void> {
    const report = await this.sweep(Date.now() - REPO_MAX_AGE_MS);
    if (report.runs > report.deleted.length)
      await this.ctx.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
  }

  /**
   * Deletes the repos of every run that began before `startedBeforeMs` and is not racing,
   * and of `race-*` repos no run knows. Each run's own RunDO decides and deletes, from the
   * one listing of the namespace made here (each run gets only its own repo names).
   */
  async sweep(startedBeforeMs: number): Promise<SweepReport> {
    const repos = await artifactsPort(this.env.ARTIFACTS).listRepos(
      (name) => runOfRepo(name) !== null,
    );
    const reposByRun = Map.groupBy(
      repos.flatMap((name) => {
        const run = runOfRepo(name);
        return run === null ? [] : [{ run, name }];
      }),
      (entry) => entry.run,
    );
    const runs = [...reposByRun.keys()];
    const outcomes = await inBatches(runs, async (run) => {
      const listed = (reposByRun.get(run) ?? []).map((entry) => entry.name);
      const result = await this.env.RUNS.getByName(run).sweep(run, startedBeforeMs, listed);
      return [{ run, result }];
    });
    const report: SweepReport = {
      runs: runs.length,
      deleted: outcomes.flatMap(({ run, result }) =>
        result.ok && result.value !== null && result.value.failed.length === 0 ? [run] : [],
      ),
      skipped: outcomes.flatMap(({ run, result }) =>
        result.ok && result.value === null ? [run] : [],
      ),
      failed: outcomes.flatMap(({ run, result }) => {
        if (!result.ok) return [{ run, error: result.error.message }];
        const failed = result.value?.failed ?? [];
        return failed.length > 0 ? [{ run, error: failed.map((f) => f.error).join('; ') }] : [];
      }),
    };
    this.#log.info('run repos swept', {
      runs: report.runs,
      deleted: report.deleted.length,
      skipped: report.skipped.length,
      failed: report.failed.length,
    });
    return report;
  }
}

/** Maps `items` a few at a time (each call wakes a RunDO) and flattens the results. */
async function inBatches<T, R>(
  items: readonly T[],
  map: (item: T) => Promise<readonly R[]>,
): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += RUN_CALL_CONCURRENCY) {
    const batch = items.slice(start, start + RUN_CALL_CONCURRENCY);
    // oxlint-disable-next-line no-await-in-loop -- batches bound the RunDOs woken at once
    const mapped = await Promise.all(batch.map(map));
    results.push(...mapped.flat());
  }
  return results;
}
