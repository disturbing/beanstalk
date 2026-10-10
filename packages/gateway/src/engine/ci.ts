import type { CiMeta } from '@gitstalk/shared-race/events';
import type { Sha } from '@gitstalk/shared-race/ids';

import type { StepContext } from './context';
import { cancelTimer, emit, setTimer, startJob } from './context';
import { EngineInvariantError } from './errors';
import type { CheckResult, CiId, CiPurpose, CiRun, CiState, JobId, Seconds } from './model';
import { roundTo } from './numbers';

/** Failing tests listed in `ci.end` (`failing_tests[:30]`). */
const CI_END_FAILING_TESTS = 30;

export type CiRequest = {
  readonly sha: Sha;
  readonly purpose: CiPurpose;
  readonly meta: CiMeta;
  readonly owner: 'policy' | 'final';
  readonly extraFiles?: Readonly<Record<string, string>>;
  /**
   * Emulated latency after the suite; defaults to `ci_seconds` plus `ci_overhead_seconds` (the
   * final check uses 0).
   */
  readonly latency?: Seconds;
  /** Run only these test files (`affected_validation`; default: the whole suite). */
  readonly only?: readonly string[];
  /** Also report every passing test file's read set (`evidence_promotion`). */
  readonly allReadSets?: true;
  /** Queue ahead of the waiting runs of this purpose (`validation_first`: of bisect probes). */
  readonly ahead?: CiPurpose;
};

/** K free slots, numbered as the harness numbers its CI worktrees. */
export function initialCiState(slots: number): CiState {
  return {
    seq: 0,
    claimed: 0,
    freeSlots: Array.from({ length: slots }, (_, index) => index),
    queue: [],
    runs: {},
    log: [],
  };
}

/** Slots not reserved by a requested run (`ci_available`). */
export function ciAvailable(ctx: StepContext): number {
  return ctx.env.config.ci_slots - ctx.state.ci.claimed;
}

/** Whether a run of `purpose` is requested (and, given `status`, in that state). */
export function hasCiRun(ctx: StepContext, purpose: CiPurpose, status?: CiRun['status']): boolean {
  return Object.values(ctx.state.ci.runs).some(
    (run) => run.purpose === purpose && (status === undefined || run.status === status),
  );
}

/**
 * Requests a suite run (`run_ci`): the reservation is taken now, the run starts when a slot
 * is free. Its result arrives after the runner's suite time plus the emulated latency.
 */
export function requestCi(ctx: StepContext, request: CiRequest): CiId {
  const ci = ctx.state.ci;
  ci.seq += 1;
  const id: CiId = `ci${String(ci.seq).padStart(4, '0')}`;
  ci.claimed += 1;
  ci.runs[id] = {
    id,
    sha: request.sha,
    purpose: request.purpose,
    meta: request.meta,
    owner: request.owner,
    extraFiles: request.extraFiles ?? null,
    latency: request.latency ?? ctx.env.config.ci_seconds + ctx.env.config.ci_overhead_seconds,
    ...(request.only === undefined ? {} : { only: [...request.only] }),
    ...(request.allReadSets === true ? { allReadSets: true } : {}),
    status: 'queued',
    slot: null,
    startedAt: null,
    jobId: null,
    timerId: null,
    result: null,
  };
  enqueue(ci, id, request.ahead);
  pumpCi(ctx);
  return id;
}

/** Starts queued runs on free slots, oldest request first. */
export function pumpCi(ctx: StepContext): void {
  const ci = ctx.state.ci;
  while (ci.queue.length > 0 && ci.freeSlots.length > 0) {
    const id = ci.queue.shift();
    const slot = ci.freeSlots.shift();
    const run = id === undefined ? undefined : ci.runs[id];
    if (run === undefined || slot === undefined) continue;
    run.status = 'running';
    run.slot = slot;
    run.startedAt = ctx.now;
    emit(ctx, 'ci.start', { ci: run.id, sha: run.sha, purpose: run.purpose, slot, ...run.meta });
    run.jobId = startJob(
      ctx,
      {
        kind: 'check',
        sha: run.sha,
        extraFiles: run.extraFiles,
        instance: { kind: 'ci', slot },
        ...(run.only === undefined ? {} : { only: run.only }),
        ...(run.allReadSets === true ? { allReadSets: true } : {}),
      },
      { kind: 'ci', ciId: run.id },
    );
  }
}

/**
 * The runner finished the suite. With latency left the slot stays busy (a timer finishes
 * the run); otherwise the run completes now and is returned for routing to its owner.
 */
export function onCheckResult(ctx: StepContext, id: CiId, result: CheckResult): CiRun | null {
  const run = ctx.state.ci.runs[id];
  if (run === undefined || run.status !== 'running') return null;
  if (run.cancelled === true) {
    releaseRun(ctx, run);
    return null;
  }
  run.result = result;
  run.jobId = null;
  if (run.latency > 0) {
    run.status = 'latency';
    run.timerId = setTimer(ctx, run.latency, { kind: 'ci-latency', ciId: id });
    return null;
  }
  return completeCi(ctx, run);
}

/** The emulated latency elapsed: the run completes. */
export function onLatencyElapsed(ctx: StepContext, id: CiId): CiRun | null {
  const run = ctx.state.ci.runs[id];
  if (run === undefined || run.status !== 'latency') return null;
  run.timerId = null;
  return completeCi(ctx, run);
}

function completeCi(ctx: StepContext, run: CiRun): CiRun {
  const result = run.result;
  if (result === null || run.slot === null || run.startedAt === null) {
    throw new EngineInvariantError(`CI run ${run.id} completed without a result`);
  }
  releaseRun(ctx, run);
  const seconds = ctx.now - run.startedAt;
  if (!result.green && (run.purpose === 'batch' || run.purpose === 'validate')) {
    ctx.state.redValidations += 1;
  }
  ctx.state.ci.log.push({ purpose: run.purpose, cancelled: false, seconds });
  emit(ctx, 'ci.end', {
    ci: run.id,
    sha: run.sha,
    purpose: run.purpose,
    green: result.green,
    slot: run.slot,
    failing_files: result.failingFiles,
    failing_tests: failingTestNames(result).slice(0, CI_END_FAILING_TESTS),
    tests: result.tests,
    failures: result.failures,
    suite_seconds: roundTo(result.suiteSeconds, 3),
    ci_seconds: roundTo(seconds, 3),
    timed_out: result.timedOut,
    ...run.meta,
  });
  return run;
}

/** `file > name` for every failing test, as the harness lists them. */
export function failingTestNames(result: CheckResult): string[] {
  return result.failingTests.map((test) => `${test.file} > ${test.name}`);
}

/**
 * Cancels a run (a speculative batch behind a red one, a superseded validation, or shutdown).
 * A run that started logs `ci.end` with `cancelled`; one still waiting for a slot just
 * disappears. `until-done` (a superseded validation): a suite already running on the runner
 * keeps its slot until the runner's job returns (`dropOrphanedCiJob`), so the next run never
 * shares the container with it; a job waiting for its retry is not run again.
 */
export function cancelCi(
  ctx: StepContext,
  id: CiId | null,
  slotRelease: 'now' | 'until-done' = 'now',
): void {
  const ci = ctx.state.ci;
  const run = id === null ? undefined : ci.runs[id];
  if (run === undefined) return;
  if (run.cancelled === true) {
    if (slotRelease === 'now') releaseRun(ctx, run);
    return;
  }
  if (run.status === 'queued') {
    ci.queue = ci.queue.filter((queued) => queued !== run.id);
    ci.claimed -= 1;
    delete ci.runs[run.id];
    return;
  }
  cancelTimer(ctx, run.timerId);
  logCancelled(ctx, run);
  if (slotRelease === 'until-done' && run.status === 'running' && run.jobId !== null) {
    run.cancelled = true;
    if (cancelJobRetry(ctx, run.jobId)) releaseRun(ctx, run);
    return;
  }
  releaseRun(ctx, run);
}

/**
 * The runner's job for a cancelled (or already released) CI run returned: its outcome, success
 * or failure, concerns nobody. The run's slot is free now. Returns whether it was such a job.
 */
export function dropOrphanedCiJob(ctx: StepContext, ciId: CiId): boolean {
  const run = ctx.state.ci.runs[ciId];
  if (run !== undefined && run.cancelled !== true) return false;
  if (run !== undefined) releaseRun(ctx, run);
  return true;
}

function logCancelled(ctx: StepContext, run: CiRun): void {
  const seconds = ctx.now - (run.startedAt ?? ctx.now);
  ctx.state.ci.log.push({ purpose: run.purpose, cancelled: true, seconds });
  emit(ctx, 'ci.end', {
    ci: run.id,
    sha: run.sha,
    purpose: run.purpose,
    green: null,
    cancelled: true,
    slot: run.slot ?? -1,
    ci_seconds: roundTo(seconds, 3),
    ...run.meta,
  });
}

/** A job waiting for its retry is not issued again: true when it was waiting (it is gone now). */
function cancelJobRetry(ctx: StepContext, jobId: JobId): boolean {
  const pending = Object.entries(ctx.state.timers).filter(
    ([, timer]) => timer.purpose.kind === 'job-retry' && timer.purpose.jobId === jobId,
  );
  for (const [timerId] of pending) delete ctx.state.timers[timerId];
  if (pending.length === 0) return false;
  delete ctx.state.jobs[jobId];
  return true;
}

/** Cancels every run (shutdown). */
export function cancelAllCi(ctx: StepContext): void {
  const ids = Object.values(ctx.state.ci.runs)
    .map((run) => run.id)
    .toSorted();
  for (const id of ids) cancelCi(ctx, id);
}

/** Appends a run to the queue, or puts it before the first waiting run of `ahead`. */
function enqueue(ci: CiState, id: CiId, ahead: CiPurpose | undefined): void {
  const index = ci.queue.findIndex((queued) => ci.runs[queued]?.purpose === ahead);
  if (ahead === undefined || index < 0) ci.queue.push(id);
  else ci.queue.splice(index, 0, id);
}

function releaseRun(ctx: StepContext, run: CiRun): void {
  const ci = ctx.state.ci;
  if (run.slot !== null) ci.freeSlots.push(run.slot);
  ci.claimed -= 1;
  delete ci.runs[run.id];
}
