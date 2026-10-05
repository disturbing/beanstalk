import type { TaskId } from '@beanstalk/shared-race/ids';
import { unionPaths, usesStructuralMerge } from '@beanstalk/shared-race/run-config';
import type { ArenaTask } from '@beanstalk/shared-race/task';
import { couplingPartners } from '@beanstalk/shared-race/task';

import type { ReworkOutcome, StepContext } from '../context';
import { emit, requireTask, startJob, taskDefinition } from '../context';
import { EngineInvariantError } from '../errors';
import { canResume, createInvocation } from '../invocations';
import type { JobId, JobResult, SlotState, TaskState } from '../model';
import {
  alsoConflictedLine,
  queueLandMessage,
  reworkConflictPrompt,
  reworkRedPrompt,
} from '../prompts';
import { hold, holderOf } from '../slots';
import { dropTask, taskBranch, taskWorkspace } from '../tasks';
import { STALK_REF } from '../refs';
import type { EjectInfo, EjectReason, QueueState, ReworkFlow } from './queue-state';

/** Failing tests quoted in a red rework prompt (`failing_tests[:20]`). */
export const EJECT_FAILING_TESTS = 20;
/** An ejected PR is dropped after this many ejections per allowed rework. */
const EJECTIONS_PER_REWORK = 3;

/**
 * Sends a PR back to its author (`QueueRace.eject`). The PR is dropped once it used its
 * reworks; otherwise its holder reworks it at once (`--queue-hold`) or it waits for a slot.
 */
export function eject(
  ctx: StepContext,
  state: QueueState,
  task: TaskState,
  reason: EjectReason,
  info: EjectInfo,
): void {
  state.stats[reason === 'conflict' ? 'ejections_conflict' : 'ejections_red'] += 1;
  const ejections = (state.ejectionsTotal[task.id] ?? 0) + 1;
  state.ejectionsTotal[task.id] = ejections;
  emit(ctx, 'queue.eject', { task: task.id, reason, files: info.files, failing: info.failing });
  const maxRework = ctx.env.config.max_rework;
  if (task.reworks >= maxRework || ejections > EJECTIONS_PER_REWORK * Math.max(1, maxRework)) {
    dropTask(ctx, task, `ejected (${reason}) after ${task.reworks} reworks`);
    return;
  }
  task.status = 'rework';
  const holder = holderOf(ctx, task.id);
  if (ctx.env.config.queue_hold && holder !== undefined && holder.id === task.agent) {
    startReworkFlow(ctx, state, task.id, holder, { reason, info });
    return;
  }
  state.reworkJobs.push({ task: task.id, reason, info });
}

/**
 * `rework_flow`: bring main into the PR and hand the conflicts or failures to the author.
 * When the conflicts of merging main are already known for the current main, no runner
 * call is needed; otherwise the runner merges first (a squash of the PR onto main).
 */
export function startReworkFlow(
  ctx: StepContext,
  state: QueueState,
  id: TaskId,
  slot: SlotState,
  ejection: { reason: EjectReason; info: EjectInfo },
): void {
  const flow: ReworkFlow = {
    task: id,
    slot: slot.id,
    reason: ejection.reason,
    info: ejection.info,
    target: state.main,
    conflicts: null,
    prepJobId: null,
  };
  state.reworks[id] = flow;
  const known = ejection.info.mainConflicts;
  if (known !== null && known.main === state.main) {
    proceed(ctx, state, flow, known.files);
    return;
  }
  flow.prepJobId = mergeCheck(ctx, requireTask(ctx, id), state);
}

function mergeCheck(ctx: StepContext, task: TaskState, state: QueueState): JobId {
  const base = task.mergedMain;
  if (base === null) throw new EngineInvariantError(`task ${task.id} has no merge base`);
  return startJob(
    ctx,
    {
      kind: 'squash',
      onto: state.main,
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

/** The flow waiting for this runner job, if any. */
export function flowForJob(state: QueueState, jobId: JobId): ReworkFlow | undefined {
  return Object.values(state.reworks).find((flow) => flow.prepJobId === jobId);
}

/** Merging main into an ejected PR failed for good: only that PR is dropped. */
export function onMergeCheckFailed(
  state: QueueState,
  failure: { jobId: JobId; error: string },
): boolean {
  const flow = flowForJob(state, failure.jobId);
  if (flow === undefined) return false;
  delete state.reworks[flow.task];
  state.lockQueue.push({
    kind: 'drop',
    task: flow.task,
    reason: `infrastructure failure: ${failure.error}`,
  });
  return true;
}

/** The runner merged main into the PR: its conflicts decide the rework prompt. */
export function onMergeChecked(
  ctx: StepContext,
  state: QueueState,
  flow: ReworkFlow,
  result: JobResult,
): void {
  if (result.kind !== 'squash') {
    throw new EngineInvariantError(`rework merge check got a ${result.kind} result`);
  }
  flow.prepJobId = null;
  proceed(ctx, state, flow, result.outcome === 'conflict' ? [...result.files] : []);
}

function proceed(ctx: StepContext, state: QueueState, flow: ReworkFlow, conflicts: string[]): void {
  flow.conflicts = conflicts;
  if (flow.reason === 'conflict' && conflicts.length === 0) {
    // Conflicted with a batch-mate, not with main: requeue without the agent. The harness
    // merges main into the branch first; the squash onto any later main is the same merge.
    state.stats.requeued_without_agent += 1;
    delete state.reworks[flow.task];
    state.lockQueue.push({ kind: 'enqueue', task: flow.task });
    return;
  }
  reworkRound(ctx, flow, conflicts, flow.reason);
}

/** One round with the author: a conflict or red prompt, resuming its session when possible. */
function reworkRound(
  ctx: StepContext,
  flow: ReworkFlow,
  conflicts: readonly string[],
  reason: EjectReason,
): void {
  const task = requireTask(ctx, flow.task);
  const definition = taskDefinition(ctx, task.id);
  task.reworks += 1;
  const resumed = canResume(ctx, task);
  const prompt = (isResumed: boolean): string =>
    reworkPrompt(definition, { conflicts, reason, info: flow.info, resumed: isResumed });
  emit(ctx, 'rework.start', {
    task: task.id,
    reason,
    conflicts: [...conflicts],
    attempt: task.reworks,
    resumed,
  });
  const merge = { sha: flow.target, ref: STALK_REF, conflicts: flow.conflicts ?? [] };
  createInvocation(ctx, {
    kind: 'rework',
    task: task.id,
    slot: flow.slot,
    attempt: task.reworks,
    prompt: prompt(resumed),
    freshPrompt: prompt(false),
    resume: resumed ? task.sessionId : null,
    workspace: (inv) => taskWorkspace(ctx, task, { kind: 'rework', inv, merge }),
    replay: {
      reset_to: flow.target,
      check: 'suite',
      fixes: reason === 'red' ? involvedFixCandidates(definition) : [],
    },
  });
}

function reworkPrompt(
  task: ArenaTask,
  round: { conflicts: readonly string[]; reason: EjectReason; info: EjectInfo; resumed: boolean },
): string {
  if (round.conflicts.length > 0 && round.reason === 'conflict') {
    return reworkConflictPrompt(task, round.conflicts, 'main', round.resumed);
  }
  const red = reworkRedPrompt(
    task,
    round.info.failing ?? [],
    round.info.output,
    'main',
    round.resumed,
  );
  return round.conflicts.length > 0 ? red + alsoConflictedLine(round.conflicts) : red;
}

/** Tasks whose replay fix patches apply to a red: its own and its semantic partners'. */
function involvedFixCandidates(task: ArenaTask): string[] {
  return [...new Set([task.id, ...couplingPartners(task, 'semantic')])];
}

/**
 * The author's rework finished. No markers: the PR re-enters the queue. Markers left:
 * another round, until the reworks run out. Replay that could not resolve: drop.
 */
export function onReworkResult(ctx: StepContext, state: QueueState, outcome: ReworkOutcome): void {
  const flow = state.reworks[outcome.task];
  if (flow === undefined) return;
  const finish = (action: QueueState['lockQueue'][number]): void => {
    delete state.reworks[outcome.task];
    state.lockQueue.push(action);
  };
  if (outcome.subtype === 'unresolved') {
    finish({
      kind: 'drop',
      task: flow.task,
      reason: 'replay could not resolve the conflict or red (limitation of replay agents)',
    });
    return;
  }
  if (outcome.markersLeft.length === 0) {
    finish(
      outcome.committed
        ? { kind: 'enqueue', task: flow.task }
        : { kind: 'drop', task: flow.task, reason: `driver reported no commit for ${outcome.inv}` },
    );
    return;
  }
  emit(ctx, 'rework.markers_left', { task: flow.task, files: [...outcome.markersLeft] });
  if (requireTask(ctx, flow.task).reworks >= ctx.env.config.max_rework) {
    finish({
      kind: 'drop',
      task: flow.task,
      reason: 'conflict markers left after the last rework',
    });
    return;
  }
  reworkRound(ctx, flow, outcome.markersLeft, 'conflict');
}

/** Rework jobs waiting for a slot (`--no-queue-hold`) start on free slots, oldest first. */
export function assignReworkJobs(
  ctx: StepContext,
  state: QueueState,
  nextSlot: () => SlotState | undefined,
): void {
  while (state.reworkJobs.length > 0) {
    const slot = nextSlot();
    const job = state.reworkJobs[0];
    if (slot === undefined || job === undefined) return;
    state.reworkJobs.shift();
    const task = requireTask(ctx, job.task);
    task.agent = slot.id;
    hold(ctx, slot, task.id);
    startReworkFlow(ctx, state, job.task, slot, { reason: job.reason, info: job.info });
  }
}
