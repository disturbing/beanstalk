/**
 * ActionsRepoDO: one per repository (doc 25 §3.1). When the stalk moves (the repo-events
 * consumer calls `stalkMoved`), it re-reads `.github/workflows/` at the new head, rewrites the
 * D1 index, refreshes the schedules (alarms) and starts the runs `push` asks for. It also
 * starts `workflow_dispatch` and `schedule` runs, numbers runs per workflow, and keeps the
 * month's Actions minutes against the repository's budget (D9).
 *
 * Stalk moves are queued in its storage first, so a failure (Artifacts down) is retried by the
 * alarm and a redelivered event starts nothing twice.
 */
import { DurableObject } from 'cloudflare:workers';

import type { ActionsEvent, RunSummary, WorkflowTrigger } from '@beanstalk/shared-race/actions';
import { ActionsRunId } from '@beanstalk/shared-race/actions';
import type { RpcResult } from '@beanstalk/shared-race/rpc';
import { z } from 'zod';

import type { RepoExplorer } from '../adapters/repo-explorer';
import { repoExplorer } from '../adapters/repo-explorer';
import { readConfig } from '../config';
import type { Logger } from '../log';
import { createLogger } from '../log';
import { d1Registry } from '../repos/registry';
import type { ActionsConfig } from './actions-config';
import { readActionsConfig } from './actions-config';
import { MIN_SCHEDULE_INTERVAL_MS, nextFireMs, parseCron } from './cron';
import type { RepoFacts } from './event-payload';
import { dispatchPayload, pushPayload, schedulePayload } from './event-payload';
import type { RunRequest } from './run-request';
import type { RunOrigin } from './secrets';
import { checkDispatchInputs, pushFires } from './triggers';
import type { IndexedWorkflow } from './workflow-index';
import { indexedSource, listIndexed, readWorkflows, writeIndex } from './workflow-index';

/** A stalk move that could not be processed is tried again after this. */
const RETRY_MS = 30_000;

/** The stalk moved (from `stalk.promoted`). */
export type StalkMoved = {
  readonly repoId: string;
  readonly sha: string;
  readonly seq: number;
  readonly beans: readonly string[];
};

export type DispatchRequest = {
  readonly repoId: string;
  readonly workflowPath: string;
  readonly inputs: Readonly<Record<string, string | number | boolean>>;
  readonly actor: string;
};

const PendingRow = z.object({ seq: z.number(), sha: z.string(), beans_json: z.string() });
const ScheduleRow = z.object({
  path: z.string(),
  cron: z.string(),
  next_ms: z.number(),
  last_ms: z.number().nullable(),
});

export class ActionsRepoDO extends DurableObject<Env> {
  readonly #sql: SqlStorage;
  readonly #config: ActionsConfig;
  readonly #log: Logger;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#sql = ctx.storage.sql;
    this.#config = readActionsConfig(env);
    this.#log = createLogger(readConfig(env).logLevel, { component: 'actions-repo' });
    migrate(this.#sql);
  }

  /** Queues a stalk move; the alarm indexes and triggers it. Idempotent per sequence number. */
  async stalkMoved(move: StalkMoved): Promise<void> {
    this.#remember('repo_id', move.repoId);
    this.#sql.exec(
      'INSERT OR IGNORE INTO pending (seq, sha, beans_json) VALUES (?, ?, ?)',
      move.seq,
      move.sha,
      JSON.stringify(move.beans),
    );
    await this.ctx.storage.setAlarm(Date.now());
  }

  /** Starts a `workflow_dispatch` run on the stalk's copy of the workflow. */
  async dispatch(request: DispatchRequest): Promise<RpcResult<RunSummary>> {
    this.#remember('repo_id', request.repoId);
    const facts = await this.#facts(request.repoId);
    if (facts === null) return invalid('not_found', 404, 'repository not found');
    const summary = (await listIndexed(this.env.FORGE, request.repoId)).find(
      (workflow) => workflow.path === request.workflowPath,
    );
    const indexed = await indexedSource(this.env.FORGE, request.repoId, request.workflowPath);
    if (summary === undefined || indexed === null)
      return invalid('not_found', 404, `no workflow ${request.workflowPath} on the stalk`);
    if (summary.state !== 'active')
      return invalid('invalid_state', 409, `${request.workflowPath} is not valid`);
    const trigger = summary.triggers.find((candidate) => candidate.kind === 'workflow_dispatch');
    if (trigger?.kind !== 'workflow_dispatch')
      return invalid(
        'invalid_request',
        400,
        `${request.workflowPath} has no workflow_dispatch trigger`,
      );
    const inputs = checkDispatchInputs(trigger.inputs, request.inputs);
    if (!inputs.ok) return invalid('invalid_request', 400, inputs.error);
    if ((await this.minutesLeft()) <= 0)
      return invalid(
        'over_limit',
        429,
        `this repository's ${this.#config.monthlyMinutes} Actions minutes for the month are used`,
      );
    const run = await this.#createRun({
      facts,
      workflow: { path: request.workflowPath, source: indexed.source },
      event: 'workflow_dispatch',
      payload: dispatchPayload({
        repo: facts,
        publicUrl: this.#config.serverUrl,
        workflowPath: request.workflowPath,
        inputs: inputs.inputs,
        actor: request.actor,
      }),
      sha: indexed.sha,
      actor: request.actor,
      inputs: inputs.inputs,
      origin: { kind: 'dispatch' },
    });
    return { ok: true, value: run };
  }

  /**
   * The repository was deleted: no more schedules, queued stalk moves or alarms (a schedule's
   * alarm would otherwise wake the object at every tick to find no repository). Idempotent.
   */
  async forget(): Promise<void> {
    for (const table of ['pending', 'handled', 'schedules', 'numbers'])
      this.#sql.exec(`DELETE FROM ${table}`);
    await this.ctx.storage.deleteAlarm();
  }

  /** Minutes the repository may still use this month (negative when over). */
  async minutesLeft(): Promise<number> {
    return this.#config.monthlyMinutes - this.#usedMinutes();
  }

  async addMinutes(minutes: number): Promise<void> {
    this.#sql.exec(
      `INSERT INTO usage (month, minutes) VALUES (?, ?)
       ON CONFLICT(month) DO UPDATE SET minutes = minutes + excluded.minutes`,
      monthOf(Date.now()),
      minutes,
    );
  }

  /** The month's usage, for Settings and operators. */
  async usage(): Promise<{
    readonly month: string;
    readonly minutes: number;
    readonly limit: number;
  }> {
    return {
      month: monthOf(Date.now()),
      minutes: this.#usedMinutes(),
      limit: this.#config.monthlyMinutes,
    };
  }

  override async alarm(): Promise<void> {
    const failed = await this.#drainPending();
    await this.#fireSchedules(Date.now());
    const next = this.#sql
      .exec<{ next: number | null }>('SELECT MIN(next_ms) AS next FROM schedules')
      .one().next;
    const times = [...(next === null ? [] : [next]), ...(failed ? [Date.now() + RETRY_MS] : [])];
    if (times.length > 0) await this.ctx.storage.setAlarm(Math.min(...times));
  }

  // Stalk moves -----------------------------------------------------------------------------

  /** Processes queued stalk moves in order; true when one failed (it stays queued). */
  async #drainPending(): Promise<boolean> {
    const rows = this.#sql.exec('SELECT seq, sha, beans_json FROM pending ORDER BY seq').toArray();
    for (const raw of rows) {
      const row = PendingRow.parse(raw);
      try {
        // oxlint-disable-next-line no-await-in-loop -- stalk moves are handled in order
        await this.#onStalk(row.sha, z.array(z.string()).parse(JSON.parse(row.beans_json)));
        this.#sql.exec('DELETE FROM pending WHERE seq = ?', row.seq);
      } catch (error: unknown) {
        this.#log.error('stalk move not indexed; retrying', { sha: row.sha, error });
        return true;
      }
    }
    return false;
  }

  async #onStalk(sha: string, beans: readonly string[]): Promise<void> {
    const repoId = this.#recall('repo_id');
    if (
      repoId === null ||
      this.#sql.exec('SELECT 1 FROM handled WHERE sha = ?', sha).toArray().length > 0
    )
      return;
    const record = await d1Registry(this.env.FORGE).byId(repoId);
    if (record === null) return;
    const facts = factsOf(record);
    const explorer = repoExplorer(this.env.REPOS, record.artifacts_repo);
    const workflows = await readWorkflows(explorer, sha, {
      maxMatrixLegs: this.#config.maxMatrixLegs,
      maxTimeoutMinutes: this.#config.jobTimeoutMinutes,
    });
    await writeIndex(this.env.FORGE, repoId, workflows);
    this.#syncSchedules(workflows, Date.now());
    const before = this.#recall('stalk_sha');
    const changedPaths = before === null ? null : await changedBetween(explorer, before, sha);
    const actor = await this.#pusher(repoId, beans);
    const firing = workflows.filter(
      (workflow) =>
        workflow.summary.state === 'active' &&
        workflow.file.triggers.some((trigger) =>
          isPushFiring(trigger, { defaultBranch: facts.defaultBranch, changedPaths }),
        ),
    );
    for (const workflow of firing) {
      // oxlint-disable-next-line no-await-in-loop -- run numbers are given in order
      await this.#createRun({
        facts,
        workflow: { path: workflow.summary.path, source: workflow.source },
        event: 'push',
        payload: pushPayload({
          repo: facts,
          publicUrl: this.#config.serverUrl,
          before,
          after: sha,
          actor,
          beans,
        }),
        sha,
        actor,
        inputs: {},
        origin: { kind: 'stalk' },
      });
    }
    this.#remember('stalk_sha', sha);
    this.#sql.exec('INSERT OR IGNORE INTO handled (sha) VALUES (?)', sha);
    this.#log.info('stalk indexed', {
      repoId,
      sha,
      workflows: workflows.length,
      runs: firing.length,
    });
  }

  /** Who moved the stalk: the author of the newest bean it carries, as the index knows it. */
  async #pusher(repoId: string, beans: readonly string[]): Promise<string> {
    const bean = beans.at(-1);
    if (bean === undefined) return 'beanstalk';
    const row = await this.env.FORGE.prepare(
      'SELECT actor FROM beans WHERE repo_id = ? AND bean = ?',
    )
      .bind(repoId, bean)
      .first<{ actor: string | null }>();
    return row?.actor ?? 'beanstalk';
  }

  // Schedules -------------------------------------------------------------------------------

  #syncSchedules(workflows: readonly IndexedWorkflow[], nowMs: number): void {
    const wanted = workflows.flatMap((workflow) =>
      workflow.summary.state !== 'active'
        ? []
        : workflow.file.triggers.flatMap((trigger) =>
            trigger.kind === 'schedule'
              ? trigger.crons
                  .filter((cron) => parseCron(cron) !== null)
                  .map((cron) => ({ path: workflow.summary.path, cron }))
              : [],
          ),
    );
    const existing = this.#schedules();
    for (const old of existing)
      if (!wanted.some((schedule) => schedule.path === old.path && schedule.cron === old.cron))
        this.#sql.exec('DELETE FROM schedules WHERE path = ? AND cron = ?', old.path, old.cron);
    for (const schedule of wanted) {
      if (existing.some((old) => old.path === schedule.path && old.cron === schedule.cron))
        continue;
      const next = nextAllowed(schedule.cron, nowMs, null);
      if (next !== null)
        this.#sql.exec(
          'INSERT INTO schedules (path, cron, next_ms, last_ms) VALUES (?, ?, ?, NULL)',
          schedule.path,
          schedule.cron,
          next,
        );
    }
  }

  async #fireSchedules(nowMs: number): Promise<void> {
    const due = this.#schedules().filter((schedule) => schedule.next_ms <= nowMs);
    const repoId = this.#recall('repo_id');
    if (due.length === 0 || repoId === null) return;
    const facts = await this.#facts(repoId);
    for (const schedule of due) {
      const next = nextAllowed(schedule.cron, nowMs, nowMs);
      this.#sql.exec(
        'UPDATE schedules SET next_ms = ?, last_ms = ? WHERE path = ? AND cron = ?',
        next ?? Number.MAX_SAFE_INTEGER,
        nowMs,
        schedule.path,
        schedule.cron,
      );
      // oxlint-disable-next-line no-await-in-loop -- one schedule at a time
      const indexed = await indexedSource(this.env.FORGE, repoId, schedule.path);
      if (facts === null || indexed === null) continue;
      // oxlint-disable-next-line no-await-in-loop -- run numbers are given in order
      await this.#createRun({
        facts,
        workflow: { path: schedule.path, source: indexed.source },
        event: 'schedule',
        payload: schedulePayload({
          repo: facts,
          publicUrl: this.#config.serverUrl,
          cron: schedule.cron,
        }),
        sha: indexed.sha,
        actor: 'schedule',
        inputs: {},
        origin: { kind: 'schedule' },
      });
    }
  }

  #schedules(): z.infer<typeof ScheduleRow>[] {
    return this.#sql
      .exec('SELECT path, cron, next_ms, last_ms FROM schedules')
      .toArray()
      .map((row) => ScheduleRow.parse(row));
  }

  // Runs ------------------------------------------------------------------------------------

  async #createRun(input: {
    readonly facts: RepoFacts;
    readonly workflow: { readonly path: string; readonly source: string };
    readonly event: ActionsEvent;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly sha: string;
    readonly actor: string;
    readonly inputs: Readonly<Record<string, string>>;
    readonly origin: RunOrigin;
  }): Promise<RunSummary> {
    const number = this.#nextNumber(input.workflow.path);
    const left = await this.minutesLeft();
    const request: RunRequest = {
      runId: ActionsRunId.parse(crypto.randomUUID()),
      number,
      repo: input.facts,
      workflow: input.workflow,
      event: input.event,
      eventPayload: input.payload,
      sha: input.sha,
      actor: input.actor,
      inputs: input.inputs,
      origin: input.origin,
      refused:
        left > 0
          ? null
          : `this repository's ${this.#config.monthlyMinutes} Actions minutes for the month are spent`,
      createdMs: Date.now(),
    };
    return this.env.ACTIONS_RUNS.getByName(request.runId).start(request);
  }

  #nextNumber(path: string): number {
    return this.#sql
      .exec<{ n: number }>(
        `INSERT INTO numbers (path, n) VALUES (?, 1)
         ON CONFLICT(path) DO UPDATE SET n = n + 1 RETURNING n`,
        path,
      )
      .one().n;
  }

  #usedMinutes(): number {
    const row = this.#sql
      .exec<{ minutes: number }>('SELECT minutes FROM usage WHERE month = ?', monthOf(Date.now()))
      .toArray()[0];
    return row?.minutes ?? 0;
  }

  async #facts(repoId: string): Promise<RepoFacts | null> {
    const record = await d1Registry(this.env.FORGE).byId(repoId);
    return record === null ? null : factsOf(record);
  }

  #remember(key: string, value: string): void {
    this.#sql.exec(
      'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      value,
    );
  }

  #recall(key: string): string | null {
    const row = this.#sql
      .exec<{ value: string }>('SELECT value FROM kv WHERE key = ?', key)
      .toArray()[0];
    return row?.value ?? null;
  }
}

function migrate(sql: SqlStorage): void {
  sql.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  sql.exec(
    'CREATE TABLE IF NOT EXISTS pending (seq INTEGER PRIMARY KEY, sha TEXT NOT NULL, beans_json TEXT NOT NULL)',
  );
  sql.exec('CREATE TABLE IF NOT EXISTS handled (sha TEXT PRIMARY KEY)');
  sql.exec(`CREATE TABLE IF NOT EXISTS schedules (path TEXT NOT NULL, cron TEXT NOT NULL,
    next_ms INTEGER NOT NULL, last_ms INTEGER, PRIMARY KEY (path, cron))`);
  sql.exec('CREATE TABLE IF NOT EXISTS numbers (path TEXT PRIMARY KEY, n INTEGER NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS usage (month TEXT PRIMARY KEY, minutes INTEGER NOT NULL)');
}

/** The repository as runs see it. */
export function factsOf(record: {
  readonly id: string;
  readonly owner: { readonly id: string; readonly handle: string };
  readonly name: string;
  readonly engine_id: string;
  readonly default_branch: string;
  readonly visibility: 'public' | 'private' | 'internal';
}): RepoFacts {
  return {
    id: record.id,
    ownerId: record.owner.id,
    ownerHandle: record.owner.handle,
    name: record.name,
    engineId: record.engine_id,
    defaultBranch: record.default_branch,
    visibility: record.visibility,
  };
}

function isPushFiring(
  trigger: WorkflowTrigger,
  move: { readonly defaultBranch: string; readonly changedPaths: readonly string[] | null },
): boolean {
  return trigger.kind === 'push' && pushFires(trigger, move);
}

/** Paths changed between two stalk heads; null when unknown (too many, or unreadable). */
async function changedBetween(
  explorer: RepoExplorer,
  before: string,
  after: string,
): Promise<string[] | null> {
  try {
    const diff = await explorer.diff(before, after, null);
    return diff.truncated ? null : diff.files.map((file) => file.path);
  } catch {
    return null;
  }
}

/** The next time a cron fires, at least 5 minutes after the last time it fired. */
function nextAllowed(cron: string, nowMs: number, lastMs: number | null): number | null {
  const schedule = parseCron(cron);
  if (schedule === null) return null;
  const earliest =
    lastMs === null ? nowMs : Math.max(nowMs, lastMs + MIN_SCHEDULE_INTERVAL_MS - 60_000);
  return nextFireMs(schedule, earliest);
}

function monthOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 7);
}

function invalid<T>(code: string, status: number, message: string): RpcResult<T> {
  return { ok: false, error: { code, status, message } };
}
