/**
 * The queue policy, ported from `research/race/harness/policy_queue.py`: a batched merge
 * queue with speculative batches stacked over K CI slots and K-ary bisection on red.
 *
 * 1. A task branches from the current green main when it starts; on finish its PR is
 *    enqueued. With `queue_hold` the author slot stays bound to the PR until it lands or
 *    bounces.
 * 2. The integrator squash-merges up to k PRs onto the batch head, one runner call each;
 *    up to K batches are in flight, each stacked on the previous one.
 * 3. A conflict with main ejects the PR to its author, who resolves the markers of a merge
 *    of main; a PR that only conflicts with PRs ahead of it is held at the front.
 * 4. CI is the full suite plus `ci_seconds` of emulated latency.
 * 5. Green fast-forwards main in batch order. Red cancels the batches stacked on it, then
 *    the culprit is found by bisection and ejected with the failing output.
 */
import type { QueuePolicyView } from '@gitstalk/shared-race/rpc';

import type { PolicyHooks, ReworkOutcome, StepContext } from '../context';
import { requireTask } from '../context';
import { EngineInvariantError } from '../errors';
import type { JobId, JobResult } from '../model';
import { roundTo } from '../numbers';
import type { PolicyModule, PolicySummary } from '../policy-module';
import { freeAskingSlot, hold } from '../slots';
import { isTerminal, startTask } from '../tasks';
import {
  drainLocked,
  onBatchWaitElapsed,
  onIntegratorJob,
  onIntegratorJobFailed,
  onQueueCi,
} from './queue-integrator';
import {
  assignReworkJobs,
  flowForJob,
  onMergeCheckFailed,
  onMergeChecked,
  onReworkResult,
} from './queue-rework';
import type { QueueState } from './queue-state';

export const queuePolicy: PolicyModule<QueueState> = {
  name: 'queue',
  init: initialQueueState,
  hooks: queueHooks,
  summary: queueSummary,
  view: queueView,
};

function initialQueueState(ctx: StepContext): QueueState {
  const base = ctx.state.baseSha;
  if (base === null) throw new EngineInvariantError('the queue starts from a base commit');
  return {
    kind: 'queue',
    main: base,
    pending: [],
    inflight: [],
    bisect: null,
    bisecting: false,
    unstarted: [...ctx.state.order],
    reworkJobs: [],
    batchSeq: 0,
    holdForInflight: false,
    enqueuedAt: {},
    ejectionsTotal: {},
    stats: {
      batches: 0,
      batches_green: 0,
      batches_red: 0,
      batches_cancelled: 0,
      bisections: 0,
      bisect_runs: 0,
      ejections_conflict: 0,
      ejections_red: 0,
      requeued_without_agent: 0,
      held_behind_inflight: 0,
      batch_sizes: [],
    },
    lock: null,
    lockQueue: [],
    reworks: {},
    batchWaitTimer: null,
  };
}

/**
 * Hooks for one step. Every entry point ends by draining the integrator lock queue, so
 * work that waited for the lock runs as soon as nothing holds it.
 */
function queueHooks(ctx: StepContext, state: QueueState): PolicyHooks {
  const thenDrain =
    <A extends unknown[]>(handler: (...args: A) => void) =>
    (...args: A): void => {
      handler(...args);
      drainLocked(ctx, state);
    };
  return {
    dispatch: () => dispatch(ctx, state),
    onInitialCommitted: thenDrain((task) => {
      state.lockQueue.push({ kind: 'enqueue', task });
    }),
    onReworkResult: thenDrain((outcome: ReworkOutcome) => onReworkResult(ctx, state, outcome)),
    onJobDone: thenDrain((jobId: JobId, result: JobResult) => onJobDone(ctx, state, jobId, result)),
    onCiDone: thenDrain((ciId, result) => onQueueCi(ctx, state, ciId, result)),
    onTimer: thenDrain((key: string) => {
      if (key === 'batch-wait') onBatchWaitElapsed(ctx, state);
    }),
    onDecision: (answer) => ({
      code: 'unknown_card',
      message: `the queue has no card ${answer.card}`,
    }),
    onJobFailed: (jobId: JobId, error: string) => {
      const failure = { jobId, error };
      const isContained =
        onIntegratorJobFailed(ctx, state, failure) || onMergeCheckFailed(state, failure);
      drainLocked(ctx, state);
      return isContained;
    },
    isFinished: () => isFinished(ctx, state),
    finalGreenSha: () => state.main,
  };
}

/**
 * `QueueRace.dispatch`: reworks waiting for a slot first, then unstarted tasks in
 * priority order from the current main, then the integrator.
 */
function dispatch(ctx: StepContext, state: QueueState): void {
  assignReworkJobs(ctx, state, () => freeAskingSlot(ctx));
  while (state.unstarted.length > 0) {
    const slot = freeAskingSlot(ctx);
    const id = state.unstarted[0];
    if (slot === undefined || id === undefined) break;
    state.unstarted.shift();
    requireTask(ctx, id).status = 'running';
    hold(ctx, slot, id);
    startTask(ctx, slot, id, state.main);
  }
  drainLocked(ctx, state);
}

function onJobDone(ctx: StepContext, state: QueueState, jobId: JobId, result: JobResult): void {
  if (onIntegratorJob(ctx, state, jobId, result)) return;
  const flow = flowForJob(state, jobId);
  if (flow !== undefined) onMergeChecked(ctx, state, flow, result);
}

function isFinished(ctx: StepContext, state: QueueState): boolean {
  return (
    Object.values(ctx.state.tasks).every(isTerminal) &&
    state.inflight.length === 0 &&
    !state.bisecting &&
    state.reworkJobs.length === 0 &&
    state.lock === null &&
    state.lockQueue.length === 0
  );
}

/** `QueueRace.policy_summary`. */
function queueSummary(state: QueueState): PolicySummary {
  const { batch_sizes: sizes, ...counts } = state.stats;
  const meanBatchSize =
    sizes.length > 0 ? roundTo(sizes.reduce((sum, size) => sum + size, 0) / sizes.length, 3) : null;
  const stats = { ...counts, mean_batch_size: meanBatchSize };
  return {
    key: 'queue',
    stats,
    rows: [
      [
        'Batches (green / red / cancelled)',
        `${stats.batches_green} / ${stats.batches_red} / ${stats.batches_cancelled}`,
      ],
      ['Bisections / bisect CI runs', `${stats.bisections} / ${stats.bisect_runs}`],
      ['Ejections (conflict / red)', `${stats.ejections_conflict} / ${stats.ejections_red}`],
      ['PRs held behind in-flight conflicts', stats.held_behind_inflight],
      ['Mean batch size', meanBatchSize],
    ],
  };
}

function queueView(state: QueueState): QueuePolicyView {
  return {
    kind: 'queue',
    stalk: state.main,
    pending: [...state.pending],
    inflight: state.inflight.map((batch) => ({
      batch: batch.id,
      tasks: [...batch.prs],
      head: batch.head,
      speculative: batch.base !== state.main,
      ci: batch.ciId,
    })),
    bisecting: state.bisect === null ? null : state.bisect.batch.id,
    rework_jobs: state.reworkJobs.map((job) => job.task),
    reworking: Object.keys(state.reworks),
    integrator: state.lock?.kind ?? 'idle',
    stats: { ...state.stats, batch_sizes: [...state.stats.batch_sizes] },
  };
}
