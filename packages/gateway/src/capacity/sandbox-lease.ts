/**
 * A repository engine's check job waits here for a pre-land sandbox of its own. Nothing runs
 * while it waits, and the runner starts a suite's timeout only when the suite starts, so time
 * queued for capacity never counts against the suite.
 */
import type { JobSpec } from '../engine/model';
import type { Logger } from '../log';
import type { AcquireInput, AcquireResult } from './runner-capacity';
import { POOL_FLOOR } from './runner-capacity';

/** The pool's two calls a lease needs (the `RunnerCapacity` stub, or a fake in tests). */
export type SandboxPoolPort = {
  acquire(input: AcquireInput): Promise<AcquireResult>;
  release(input: { readonly engine: string; readonly job: string }): Promise<void>;
};

export type LeaseClock = {
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
};

export type SandboxLeaseRequest = Omit<AcquireInput, 'waitingSinceMs'>;

/** A sandbox index of the engine: from the pool, or (pool unreachable) one of the floor's. */
export type HeldSandbox = { readonly index: number; readonly waitedMs: number };

/** Pause before asking the pool again, growing to the longest. */
const FIRST_PAUSE_MS = 1000;
const LONGEST_PAUSE_MS = 5000;

/**
 * Asks the pool until it grants a sandbox. A pool that cannot be reached is no reason to stop
 * checks: the job then runs on one of the two floor sandboxes every engine is entitled to.
 */
export async function leaseSandbox(
  pool: SandboxPoolPort,
  request: SandboxLeaseRequest,
  deps: { readonly clock: LeaseClock; readonly log: Logger },
): Promise<HeldSandbox> {
  const waitingSinceMs = deps.clock.now();
  let pause = FIRST_PAUSE_MS;
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop -- each ask depends on the pool having changed
    const answer = await askPool(pool, { ...request, waitingSinceMs }, deps.log);
    const waitedMs = deps.clock.now() - waitingSinceMs;
    if (answer === null) return { index: floorIndex(request.job), waitedMs };
    if (answer.kind === 'granted') return { index: answer.index, waitedMs };
    // oxlint-disable-next-line no-await-in-loop -- waiting for capacity is the point
    await deps.clock.sleep(pause);
    pause = Math.min(LONGEST_PAUSE_MS, pause * 2);
  }
}

/**
 * Whether a job runs in a leased sandbox: a repository engine's suites in a bean's sandbox
 * (pre-land checks, culprit probes). A race's agent slots each have their own sandbox.
 */
export function needsSandboxLease(
  spec: JobSpec,
  config: { readonly continuous: boolean },
): boolean {
  return config.continuous && spec.kind === 'check' && spec.instance.kind === 'sandbox';
}

/** Gives the sandbox back; a failure only delays its reuse until the lease expires. */
export async function releaseSandbox(
  pool: SandboxPoolPort,
  lease: { readonly engine: string; readonly job: string },
  log: Logger,
): Promise<void> {
  try {
    await pool.release(lease);
  } catch (error: unknown) {
    log.warn('releasing a sandbox lease failed', { ...lease, error });
  }
}

async function askPool(
  pool: SandboxPoolPort,
  input: AcquireInput,
  log: Logger,
): Promise<AcquireResult | null> {
  try {
    return await pool.acquire(input);
  } catch (error: unknown) {
    log.warn('the runner pool is unreachable; using a floor sandbox', {
      engine: input.engine,
      job: input.job,
      error,
    });
    return null;
  }
}

/** One of the floor's sandboxes, spread by job id. */
function floorIndex(job: string): number {
  let hash = 0;
  for (const char of job) hash = (hash * 31 + char.charCodeAt(0)) % 65_521;
  return hash % POOL_FLOOR;
}
