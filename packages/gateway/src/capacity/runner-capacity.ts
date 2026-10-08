/**
 * RunnerCapacity: one Durable Object (`pool`) that shares the runner container class between
 * races and repository engines (`sandbox-pool.ts` holds the rule). Races reserve their
 * instances at the start and release them when done; repository engines lease one pre-land
 * sandbox per bean in check and release it when the check ends. Expired entries (a run that
 * never said it was done, a check whose object went away) are dropped on every call.
 */
import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';

import { actionsMaxInstances, readConfig } from '../config';
import type { Logger } from '../log';
import { createLogger } from '../log';
import type {
  EngineSeen,
  LeaseDecision,
  PoolLimits,
  PoolState,
  RaceReservation,
  SandboxLease,
  WaitReason,
} from './sandbox-pool';
import { decideLease } from './sandbox-pool';

/** The pool's one instance. */
export const RUNNER_POOL_NAME = 'pool';
/** Instances kept out of the repositories' share (cold starts, a committer that wakes). */
export const POOL_HEADROOM = 2;
/**
 * A repository engine's pre-land sandboxes at most, unless its `preland_sandboxes` says
 * otherwise: enough that 16 to 32 beans in check at once do not queue.
 */
export const DEFAULT_PRELAND_SANDBOXES = 32;
/** Sandboxes a repository engine always gets: the old shared pool's two. */
export const POOL_FLOOR = 2;
/** A lease outlives its check by far: three suite timeouts plus capacity waits. */
export const LEASE_TTL_MS = 40 * 60 * 1000;
/** Engines dropped from the pool's memory once idle this long. */
const ENGINE_FORGET_MS = 24 * 60 * 60 * 1000;

/** `acquire`'s input: a check job asks for a sandbox (`waitingSinceMs`: when it first asked). */
export type AcquireInput = {
  readonly engine: string;
  readonly job: string;
  readonly cap: number;
  readonly base: number;
  readonly waitingSinceMs: number;
};

export type AcquireResult = LeaseDecision & { readonly inUse: number };

/** Per owner (engine or race run): what the pool did for it, for operators and load tests. */
export type PoolStats = {
  readonly owner: string;
  readonly granted: number;
  readonly waits: number;
  readonly waitedSeconds: number;
  readonly peak: number;
  readonly timeouts: number;
};

export type PoolSnapshot = {
  readonly limits: PoolLimits;
  readonly races: readonly RaceReservation[];
  readonly leases: readonly SandboxLease[];
  readonly engines: readonly EngineSeen[];
  readonly stats: readonly PoolStats[];
};

const StatsRow = z.object({
  owner: z.string(),
  granted: z.number(),
  waits: z.number(),
  waited_ms: z.number(),
  peak: z.number(),
  timeouts: z.number(),
});

export class RunnerCapacity extends DurableObject<Env> {
  readonly #log: Logger;
  readonly #limits: PoolLimits;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const config = readConfig(env);
    this.#log = createLogger(config.logLevel, { component: 'runner-capacity' });
    this.#limits = {
      instances: config.runnerMaxInstances,
      headroom: POOL_HEADROOM,
      floor: POOL_FLOOR,
      actionsInstances: actionsMaxInstances(env),
    };
    migrate(ctx.storage.sql);
  }

  /** A sandbox for one check job, or why it must wait (it asks again shortly). */
  async acquire(input: AcquireInput): Promise<AcquireResult> {
    const nowMs = Date.now();
    this.#prune(nowMs);
    const decision = decideLease(
      this.#state(),
      { engine: input.engine, job: input.job, cap: input.cap, base: input.base, nowMs },
      this.#limits,
    );
    const waiting = decision.kind === 'wait' ? nowMs : null;
    this.ctx.storage.sql.exec(
      `INSERT INTO engines (engine, base, seen_ms, waiting_ms) VALUES (?, ?, ?, ?)
       ON CONFLICT(engine) DO UPDATE SET base = excluded.base, seen_ms = excluded.seen_ms,
         waiting_ms = excluded.waiting_ms`,
      input.engine,
      input.base,
      nowMs,
      waiting,
    );
    if (decision.kind === 'granted') this.#grant(input, { ...decision, nowMs });
    else this.#noteWait(input.engine, decision.reason);
    return { ...decision, inUse: this.#count('SELECT COUNT(*) AS n FROM leases') };
  }

  /** The check ended: its sandbox goes back to the pool. */
  async release(input: { readonly engine: string; readonly job: string }): Promise<void> {
    this.ctx.storage.sql.exec(
      'DELETE FROM leases WHERE engine = ? AND job = ?',
      input.engine,
      input.job,
    );
  }

  /** A race starts: its instances are counted until it is done (or `untilMs`). */
  async reserveRace(reservation: RaceReservation): Promise<void> {
    this.ctx.storage.sql.exec(
      `INSERT INTO races (run, instances, until_ms) VALUES (?, ?, ?)
       ON CONFLICT(run) DO UPDATE SET instances = excluded.instances, until_ms = excluded.until_ms`,
      reservation.run,
      reservation.instances,
      reservation.untilMs,
    );
  }

  async releaseRace(run: string): Promise<void> {
    this.ctx.storage.sql.exec('DELETE FROM races WHERE run = ?', run);
  }

  /** A suite ran past its timeout and was re-run (`run-jobs.ts`): counted for the owner. */
  async noteTimeout(owner: string): Promise<void> {
    this.#bumpStats(owner, { timeouts: 1 });
  }

  /** Everything the pool holds now, for `GET /v1/capacity`. */
  async snapshot(): Promise<PoolSnapshot> {
    this.#prune(Date.now());
    const stats = this.ctx.storage.sql
      .exec('SELECT owner, granted, waits, waited_ms, peak, timeouts FROM stats ORDER BY owner')
      .toArray()
      .flatMap((row) => {
        const parsed = StatsRow.safeParse(row);
        return parsed.success ? [toStats(parsed.data)] : [];
      });
    return { limits: this.#limits, ...this.#state(), stats };
  }

  #grant(input: AcquireInput, at: { index: number; isRenewal: boolean; nowMs: number }): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO leases (engine, job, idx, until_ms) VALUES (?, ?, ?, ?)
       ON CONFLICT(engine, job) DO UPDATE SET until_ms = excluded.until_ms`,
      input.engine,
      input.job,
      at.index,
      at.nowMs + LEASE_TTL_MS,
    );
    if (at.isRenewal) return;
    const held = this.#count('SELECT COUNT(*) AS n FROM leases WHERE engine = ?', [input.engine]);
    this.#bumpStats(input.engine, {
      granted: 1,
      waitedMs: Math.max(0, at.nowMs - input.waitingSinceMs),
      peak: held,
    });
  }

  #noteWait(engine: string, reason: WaitReason): void {
    this.#bumpStats(engine, { waits: 1 });
    this.#log.debug('sandbox lease waits', { engine, reason });
  }

  #bumpStats(
    owner: string,
    add: { granted?: number; waits?: number; waitedMs?: number; peak?: number; timeouts?: number },
  ): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO stats (owner, granted, waits, waited_ms, peak, timeouts) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner) DO UPDATE SET granted = granted + excluded.granted,
         waits = waits + excluded.waits, waited_ms = waited_ms + excluded.waited_ms,
         peak = MAX(peak, excluded.peak), timeouts = timeouts + excluded.timeouts`,
      owner,
      add.granted ?? 0,
      add.waits ?? 0,
      add.waitedMs ?? 0,
      add.peak ?? 0,
      add.timeouts ?? 0,
    );
  }

  #state(): PoolState {
    const sql = this.ctx.storage.sql;
    return {
      races: sql
        .exec<{ run: string; instances: number; until_ms: number }>(
          'SELECT run, instances, until_ms FROM races',
        )
        .toArray()
        .map((row) => ({ run: row.run, instances: row.instances, untilMs: row.until_ms })),
      leases: sql
        .exec<{ engine: string; job: string; idx: number; until_ms: number }>(
          'SELECT engine, job, idx, until_ms FROM leases ORDER BY engine, idx',
        )
        .toArray()
        .map((row) => ({
          engine: row.engine,
          job: row.job,
          index: row.idx,
          untilMs: row.until_ms,
        })),
      engines: sql
        .exec<{ engine: string; base: number; seen_ms: number; waiting_ms: number | null }>(
          'SELECT engine, base, seen_ms, waiting_ms FROM engines',
        )
        .toArray()
        .map((row) => ({
          engine: row.engine,
          base: row.base,
          seenMs: row.seen_ms,
          waitingMs: row.waiting_ms,
        })),
    };
  }

  #prune(nowMs: number): void {
    const sql = this.ctx.storage.sql;
    sql.exec('DELETE FROM races WHERE until_ms <= ?', nowMs);
    sql.exec('DELETE FROM leases WHERE until_ms <= ?', nowMs);
    sql.exec('DELETE FROM engines WHERE seen_ms <= ?', nowMs - ENGINE_FORGET_MS);
  }

  #count(query: string, bindings: readonly (string | number)[] = []): number {
    const row = this.ctx.storage.sql.exec<{ n: number }>(query, ...bindings).one();
    return row.n;
  }
}

function migrate(sql: SqlStorage): void {
  sql.exec(`CREATE TABLE IF NOT EXISTS races (
    run TEXT PRIMARY KEY, instances INTEGER NOT NULL, until_ms INTEGER NOT NULL)`);
  sql.exec(`CREATE TABLE IF NOT EXISTS leases (
    engine TEXT NOT NULL, job TEXT NOT NULL, idx INTEGER NOT NULL, until_ms INTEGER NOT NULL,
    PRIMARY KEY (engine, job))`);
  sql.exec(`CREATE TABLE IF NOT EXISTS engines (
    engine TEXT PRIMARY KEY, base INTEGER NOT NULL, seen_ms INTEGER NOT NULL, waiting_ms INTEGER)`);
  sql.exec(`CREATE TABLE IF NOT EXISTS stats (
    owner TEXT PRIMARY KEY, granted INTEGER NOT NULL, waits INTEGER NOT NULL,
    waited_ms INTEGER NOT NULL, peak INTEGER NOT NULL, timeouts INTEGER NOT NULL)`);
}

function toStats(row: z.infer<typeof StatsRow>): PoolStats {
  return {
    owner: row.owner,
    granted: row.granted,
    waits: row.waits,
    waitedSeconds: Math.round(row.waited_ms / 100) / 10,
    peak: row.peak,
    timeouts: row.timeouts,
  };
}
