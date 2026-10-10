import type { Sha, TaskId } from '@gitstalk/shared-race/ids';
import { unionPaths, usesStructuralMerge } from '@gitstalk/shared-race/run-config';

import { markAborted } from '../abort';
import { bisectPoints } from '../bisect';
import { ciAvailable, cancelCi, failingTestNames, requestCi } from '../ci';
import type { StepContext } from '../context';
import { emit, requireTask, setTimer, startJob, taskDefinition } from '../context';
import { EngineInvariantError, assertNever } from '../errors';
import type { CheckResult, CiId, JobId, JobResult, TaskState } from '../model';
import { queueLandMessage } from '../prompts';
import { holderOf, release } from '../slots';
import { dropTask, recordLanding, taskBranch } from '../tasks';
import { STALK_REF } from '../refs';
import { EJECT_FAILING_TESTS, eject } from './queue-rework';
import type { Batch, BuildState, LandContinuation, LockedAction, QueueState } from './queue-state';

/**
 * Runs the work waiting for the integrator lock, in arrival order, until something holds
 * the lock across a runner call; then (lock free) lets the integrator build batches.
 */
export function drainLocked(ctx: StepContext, state: QueueState): void {
  while (state.lock === null) {
    const action = state.lockQueue.shift();
    if (action === undefined) break;
    performLocked(ctx, state, action);
  }
  if (state.lock === null) integrate(ctx, state);
}

function performLocked(ctx: StepContext, state: QueueState, action: LockedAction): void {
  switch (action.kind) {
    case 'enqueue':
      enqueue(ctx, state, requireTask(ctx, action.task));
      return;
    case 'batch-result': {
      const batch = state.inflight.find((candidate) => candidate.id === action.batch);
      if (batch === undefined || batch.cancelled) return;
      batch.result = action.result;
      resolve(ctx, state);
      return;
    }
    case 'bisect-end':
      bisectEnd(ctx, state);
      return;
    case 'drop':
      dropTask(ctx, requireTask(ctx, action.task), action.reason);
      return;
    default:
      assertNever(action);
  }
}

/** A finished task enters the queue (`QueueRace.enqueue`). */
function enqueue(ctx: StepContext, state: QueueState, task: TaskState): void {
  const head = task.headSha;
  if (head === null) throw new EngineInvariantError(`task ${task.id} enqueued without a head`);
  task.status = 'queued';
  state.pending.push(task.id);
  state.enqueuedAt[task.id] = ctx.now;
  emit(ctx, 'queue.enqueue', { task: task.id, sha: head, depth: state.pending.length });
  if (!ctx.env.config.queue_hold && task.agent !== null) release(ctx, task.agent);
}

/**
 * `integrate`: while PRs wait, nothing holds the queue, fewer than K batches are in flight
 * and a CI slot is free, build the next batch on top of the last in-flight one.
 */
function integrate(ctx: StepContext, state: QueueState): void {
  if (state.lock !== null || state.bisecting) return;
  if (state.holdForInflight && state.inflight.length === 0) state.holdForInflight = false;
  const config = ctx.env.config;
  const canBuild =
    state.pending.length > 0 &&
    !state.holdForInflight &&
    state.inflight.length < Math.max(1, config.ci_slots) &&
    ciAvailable(ctx) > 0;
  if (!canBuild || !isBatchReady(ctx, state)) return;
  const base = state.inflight.at(-1)?.head ?? state.main;
  state.lock = {
    kind: 'build',
    build: { base, cur: base, prs: [], commits: [], files: [], step: null },
  };
  buildNext(ctx, state);
}

/**
 * The batching window (`batch_ready`): start once k PRs wait, the oldest waited
 * `batch_wait` seconds, or no agent is still working on an unqueued task.
 */
function isBatchReady(ctx: StepContext, state: QueueState): boolean {
  const config = ctx.env.config;
  if (config.batch_wait <= 0 || state.pending.length >= Math.max(1, config.batch)) return true;
  const oldest = Math.min(...state.pending.map((id) => state.enqueuedAt[id] ?? ctx.now));
  if (ctx.now - oldest >= config.batch_wait) return true;
  const isMoreComing =
    state.unstarted.length > 0 ||
    Object.values(ctx.state.tasks).some(
      (task) => task.status === 'running' || task.status === 'rework',
    );
  if (!isMoreComing) return true;
  // The harness re-checks every 0.5 s; a timer at the window's end has the same effect.
  state.batchWaitTimer ??= setTimer(ctx, oldest + config.batch_wait - ctx.now, {
    kind: 'policy',
    key: 'batch-wait',
  });
  return false;
}

function currentBuild(state: QueueState): BuildState {
  if (state.lock?.kind !== 'build') throw new EngineInvariantError('no batch is being built');
  return state.lock.build;
}

/** `build_batch`: squash the next pending PR onto the batch head. */
function buildNext(ctx: StepContext, state: QueueState): void {
  const build = currentBuild(state);
  const id =
    build.prs.length < Math.max(1, ctx.env.config.batch) ? state.pending.shift() : undefined;
  if (id === undefined) {
    finishBuild(ctx, state);
    return;
  }
  build.step = { phase: 'squash', task: id, jobId: squash(ctx, requireTask(ctx, id), build.cur) };
}

function squash(ctx: StepContext, task: TaskState, onto: Sha): JobId {
  const base = task.mergedMain;
  if (base === null) throw new EngineInvariantError(`task ${task.id} has no merge base`);
  return startJob(
    ctx,
    {
      kind: 'squash',
      onto,
      changeKey: task.id,
      changeRef: `refs/heads/${taskBranch(task.id)}`,
      changeBase: base,
      message: queueLandMessage(taskDefinition(ctx, task.id)),
      unionPaths: unionPaths(ctx.env.config),
      structural: usesStructuralMerge(ctx.env.config),
    },
    { kind: 'policy' },
  );
}

/** A runner job of the integrator finished (a squash of the build or the landing push). */
export function onIntegratorJob(
  ctx: StepContext,
  state: QueueState,
  jobId: JobId,
  result: JobResult,
): boolean {
  const lock = state.lock;
  if (lock?.kind === 'build' && lock.build.step?.jobId === jobId) {
    onBuildStep(ctx, state, result);
    return true;
  }
  if (lock?.kind === 'land' && lock.landing.jobId === jobId) {
    onLanded(ctx, state, result);
    return true;
  }
  return false;
}

/**
 * A squash of the batch being built failed for good: only that PR is dropped, and the build
 * goes on without it. A failed landing push is not contained (main may have moved).
 */
export function onIntegratorJobFailed(
  ctx: StepContext,
  state: QueueState,
  failure: { jobId: JobId; error: string },
): boolean {
  if (state.lock?.kind !== 'build') return false;
  const build = state.lock.build;
  const step = build.step;
  if (step === null || step.jobId !== failure.jobId) return false;
  build.step = null;
  dropTask(ctx, requireTask(ctx, step.task), `infrastructure failure: ${failure.error}`);
  buildNext(ctx, state);
  return true;
}

function onBuildStep(ctx: StepContext, state: QueueState, result: JobResult): void {
  const build = currentBuild(state);
  const step = build.step;
  if (step === null || result.kind !== 'squash')
    throw new EngineInvariantError('unexpected build result');
  build.step = null;
  const task = requireTask(ctx, step.task);
  if (step.phase === 'squash' && result.outcome === 'clean') {
    build.prs.push(task.id);
    build.commits.push(result.sha);
    build.files.push([...result.files]);
    build.cur = result.sha;
    buildNext(ctx, state);
    return;
  }
  if (step.phase === 'squash') {
    onSquashConflict(ctx, state, task, [...result.files]);
    return;
  }
  if (result.outcome === 'clean') {
    holdBehindInflight(ctx, state, task, step.conflicts);
    return;
  }
  conflictEject(ctx, state, task, step.conflicts, [...result.files]);
  buildNext(ctx, state);
}

/** A PR conflicts with the batch head: if that head is not main, check main itself. */
function onSquashConflict(
  ctx: StepContext,
  state: QueueState,
  task: TaskState,
  conflicts: string[],
): void {
  const build = currentBuild(state);
  if (build.cur !== state.main) {
    const jobId = squash(ctx, task, state.main);
    build.step = { phase: 'main-check', task: task.id, jobId, conflicts };
    return;
  }
  conflictEject(ctx, state, task, conflicts, conflicts);
  buildNext(ctx, state);
}

/** Only PRs ahead of it conflict: it keeps its place until they land or bounce. */
function holdBehindInflight(
  ctx: StepContext,
  state: QueueState,
  task: TaskState,
  conflicts: string[],
): void {
  const build = currentBuild(state);
  state.pending.unshift(task.id);
  state.holdForInflight = true;
  state.stats.held_behind_inflight += 1;
  emit(ctx, 'queue.hold', {
    task: task.id,
    files: conflicts,
    behind: [...build.prs, ...state.inflight.flatMap((batch) => batch.prs)],
  });
  finishBuild(ctx, state);
}

function conflictEject(
  ctx: StepContext,
  state: QueueState,
  task: TaskState,
  conflicts: string[],
  mainConflicts: string[],
): void {
  const build = currentBuild(state);
  ctx.state.conflictsMet += 1;
  task.conflicts += 1;
  emit(ctx, 'merge.conflict', {
    task: task.id,
    onto: build.cur,
    onto_main: build.cur === state.main,
    files: conflicts,
    batch_mates: [...build.prs],
  });
  eject(ctx, state, task, 'conflict', {
    files: conflicts,
    failing: null,
    output: '',
    batch: null,
    mainConflicts: { main: state.main, files: mainConflicts },
  });
}

/** The batch is complete: test it on a CI slot and keep integrating. */
function finishBuild(ctx: StepContext, state: QueueState): void {
  const build = currentBuild(state);
  state.lock = null;
  if (build.prs.length > 0) {
    state.batchSeq += 1;
    const batch: Batch = {
      id: `b${String(state.batchSeq).padStart(3, '0')}`,
      base: build.base,
      prs: build.prs,
      commits: build.commits,
      files: build.files,
      head: build.cur,
      ciId: null,
      result: null,
      cancelled: false,
    };
    startBatch(ctx, state, batch);
  }
  drainLocked(ctx, state);
}

function startBatch(ctx: StepContext, state: QueueState, batch: Batch): void {
  state.stats.batches += 1;
  state.stats.batch_sizes.push(batch.prs.length);
  for (const id of batch.prs) requireTask(ctx, id).status = 'testing';
  emit(ctx, 'batch.start', {
    batch: batch.id,
    base: batch.base,
    head: batch.head,
    tasks: [...batch.prs],
    speculative: batch.base !== state.main,
  });
  state.inflight.push(batch);
  batch.ciId = requestCi(ctx, {
    sha: batch.head,
    purpose: 'batch',
    meta: { batch: batch.id, tasks: [...batch.prs] },
    owner: 'policy',
  });
}

/** A CI run of the queue finished: a batch result waits for the lock; a probe feeds the bisection. */
export function onQueueCi(
  ctx: StepContext,
  state: QueueState,
  ciId: CiId,
  result: CheckResult,
): void {
  const batch = state.inflight.find((candidate) => candidate.ciId === ciId);
  if (batch !== undefined) {
    state.lockQueue.push({ kind: 'batch-result', batch: batch.id, result });
    return;
  }
  const bisect = state.bisect;
  if (bisect !== null && bisect.probes[ciId] !== undefined) onBisectProbe(ctx, state, ciId, result);
}

/**
 * `resolve`: settle in-flight batches in order. Green lands; red cancels everything
 * stacked on it, requeues those PRs, and ejects or bisects.
 */
function resolve(ctx: StepContext, state: QueueState): void {
  const head = state.inflight[0];
  if (head === undefined || head.result === null) return;
  state.inflight.shift();
  state.holdForInflight = false;
  if (head.result.green) {
    state.stats.batches_green += 1;
    startLand(
      ctx,
      state,
      { prs: head.prs, commits: head.commits, files: head.files },
      { kind: 'resolve' },
    );
    return;
  }
  onRedBatch(ctx, state, head, head.result);
}

function onRedBatch(ctx: StepContext, state: QueueState, red: Batch, result: CheckResult): void {
  state.stats.batches_red += 1;
  const later = state.inflight;
  state.inflight = [];
  for (const batch of later) {
    batch.cancelled = true;
    state.stats.batches_cancelled += 1;
    emit(ctx, 'batch.cancel', { batch: batch.id, tasks: [...batch.prs], because: red.id });
    cancelCi(ctx, batch.ciId);
  }
  requeueFront(
    ctx,
    state,
    later.flatMap((batch) => batch.prs),
  );
  emit(ctx, 'batch.red', { batch: red.id, tasks: [...red.prs], failing: result.failingFiles });
  if (red.prs.length === 1) {
    ejectCulprit(ctx, state, red, 0, result);
    return;
  }
  state.bisecting = true;
  startBisect(ctx, state, red);
}

/** Puts PRs back at the front of the queue, keeping their order. */
function requeueFront(ctx: StepContext, state: QueueState, ids: readonly TaskId[]): void {
  for (const id of ids.toReversed()) {
    requireTask(ctx, id).status = 'queued';
    state.pending.unshift(id);
  }
}

type Landing = { prs: TaskId[]; commits: Sha[]; files: string[][] };

/** `land`: fast-forward main to the last commit with a push-with-lease, holding the lock. */
function startLand(
  ctx: StepContext,
  state: QueueState,
  landing: Landing,
  after: LandContinuation,
): void {
  const newSha = landing.commits.at(-1);
  if (newSha === undefined) throw new EngineInvariantError('landing without commits');
  const jobId = startJob(
    ctx,
    { kind: 'update-ref', ref: STALK_REF, newSha, oldSha: state.main },
    { kind: 'policy' },
  );
  state.lock = { kind: 'land', landing: { jobId, ...landing, after } };
}

function onLanded(ctx: StepContext, state: QueueState, result: JobResult): void {
  if (state.lock?.kind !== 'land' || result.kind !== 'update-ref') {
    throw new EngineInvariantError('unexpected landing result');
  }
  const landing = state.lock.landing;
  state.lock = null;
  const newSha = landing.commits.at(-1);
  if (newSha === undefined) throw new EngineInvariantError('landing without commits');
  if (!result.ok && result.actual !== newSha) {
    markAborted(
      ctx,
      `the stalk moved unexpectedly: expected ${state.main}, found ${String(result.actual)}`,
    );
    return;
  }
  state.main = newSha;
  recordLandings(ctx, landing);
  emit(ctx, 'green.promote', { sha: state.main, tasks: [...landing.prs] });
  if (landing.after.kind === 'resolve') resolve(ctx, state);
  else bisectEndTail(ctx, state);
  drainLocked(ctx, state);
}

function recordLandings(ctx: StepContext, landing: Landing): void {
  landing.prs.forEach((id, index) => {
    const task = requireTask(ctx, id);
    const sha = landing.commits[index];
    if (sha === undefined) throw new EngineInvariantError(`no commit for ${id}`);
    recordLanding(ctx, task, sha, landing.files[index] ?? []);
    task.status = 'green';
    task.landedAt = ctx.now;
    task.greenAt = ctx.now;
    emit(ctx, 'land', { task: id, sha, target: 'main', files: task.writeSet });
    if (task.agent !== null && holderOf(ctx, id)?.id === task.agent) release(ctx, task.agent);
  });
}

/** K-ary search over the red batch's prefixes (`bisect`). */
function startBisect(ctx: StepContext, state: QueueState, red: Batch): void {
  const result = red.result;
  if (result === null) throw new EngineInvariantError('bisecting a batch without a result');
  state.bisect = {
    batch: red,
    lo: 0,
    hi: red.prs.length,
    results: { [red.prs.length]: result },
    probes: {},
    points: [],
  };
  state.stats.bisections += 1;
  emit(ctx, 'bisect.start', { batch: red.id, tasks: [...red.prs] });
  bisectRound(ctx, state);
}

/** One round: K probes (one per CI slot) at evenly spaced prefix lengths. */
function bisectRound(ctx: StepContext, state: QueueState): void {
  const bisect = state.bisect;
  if (bisect === null) return;
  if (bisect.hi - bisect.lo <= 1) {
    state.lockQueue.push({ kind: 'bisect-end' });
    return;
  }
  bisect.points = bisectPoints(bisect.lo, bisect.hi, ctx.env.config.ci_slots);
  bisect.probes = {};
  for (const point of bisect.points) {
    const sha = bisect.batch.commits[point - 1];
    if (sha === undefined) throw new EngineInvariantError(`no prefix ${point}`);
    const ciId = requestCi(ctx, {
      sha,
      purpose: 'bisect',
      meta: { batch: bisect.batch.id, prefix: point },
      owner: 'policy',
    });
    bisect.probes[ciId] = point;
  }
  state.stats.bisect_runs += bisect.points.length;
}

function onBisectProbe(ctx: StepContext, state: QueueState, ciId: CiId, result: CheckResult): void {
  const bisect = state.bisect;
  const point = bisect?.probes[ciId];
  if (bisect === null || point === undefined) return;
  delete bisect.probes[ciId];
  bisect.results[point] = result;
  if (Object.keys(bisect.probes).length > 0) return;
  const isGreen = (prefix: number): boolean => bisect.results[prefix]?.green === true;
  const reds = bisect.points.filter((prefix) => !isGreen(prefix));
  if (reds.length > 0) {
    const newHi = Math.min(...reds);
    bisect.lo = Math.max(
      bisect.lo,
      ...bisect.points.filter((prefix) => isGreen(prefix) && prefix < newHi),
    );
    bisect.hi = newHi;
  } else {
    bisect.lo = Math.max(...bisect.points);
  }
  bisectRound(ctx, state);
}

/** The culprit is found: land the green prefix (lock held), then requeue and eject. */
function bisectEnd(ctx: StepContext, state: QueueState): void {
  const bisect = state.bisect;
  if (bisect === null) return;
  const prefix = bisect.hi - 1;
  if (prefix > 0) {
    const { batch } = bisect;
    startLand(
      ctx,
      state,
      {
        prs: batch.prs.slice(0, prefix),
        commits: batch.commits.slice(0, prefix),
        files: batch.files.slice(0, prefix),
      },
      { kind: 'bisect-end' },
    );
    return;
  }
  bisectEndTail(ctx, state);
}

function bisectEndTail(ctx: StepContext, state: QueueState): void {
  const bisect = state.bisect;
  if (bisect === null) return;
  const { batch, hi } = bisect;
  const culprit = batch.prs[hi - 1];
  const result = bisect.results[hi];
  if (culprit === undefined || result === undefined)
    throw new EngineInvariantError('bisection lost its culprit');
  const rest = batch.prs.slice(hi);
  requeueFront(ctx, state, rest);
  emit(ctx, 'bisect.end', {
    batch: batch.id,
    culprit,
    landed: batch.prs.slice(0, hi - 1),
    requeued: rest,
  });
  ejectCulprit(ctx, state, batch, hi - 1, result);
  state.bisecting = false;
  state.bisect = null;
}

/**
 * The culprit goes back to its author with the failures. Its squash parent is main now,
 * so merging main into it is clean: the rework needs no runner call.
 */
function ejectCulprit(
  ctx: StepContext,
  state: QueueState,
  batch: Batch,
  index: number,
  result: CheckResult,
): void {
  const id = batch.prs[index];
  if (id === undefined) throw new EngineInvariantError(`batch ${batch.id} has no PR ${index}`);
  const task = requireTask(ctx, id);
  task.reds += 1;
  eject(ctx, state, task, 'red', {
    files: result.failingFiles === null ? null : [...result.failingFiles],
    failing: failingTestNames(result).slice(0, EJECT_FAILING_TESTS),
    output: result.output,
    batch: batch.id,
    mainConflicts: { main: state.main, files: [] },
  });
}

/** `batch_wait` elapsed: the integrator re-checks the batching window. */
export function onBatchWaitElapsed(ctx: StepContext, state: QueueState): void {
  state.batchWaitTimer = null;
  drainLocked(ctx, state);
}
