import type { InvocationKind, InvocationResult } from '@beanstalk/shared-race/driver';
import type { InvocationId, Sha, TaskId } from '@beanstalk/shared-race/ids';
import { protectTestsMode, unionPaths } from '@beanstalk/shared-race/run-config';

import { placementModules } from './arena';
import type { StepContext } from './context';
import {
  acceptanceTests,
  emit,
  isRacing,
  policyHooks,
  promptTask,
  requireSlot,
  requireTask,
  setTimer,
  taskDefinition,
} from './context';
import { EngineInvariantError } from './errors';
import { createInvocation, isResumable } from './invocations';
import type {
  EngineWorkspace,
  OpenInvocation,
  ProtectedTestRef,
  SlotState,
  StoredWorkspace,
  TaskState,
} from './model';
import { initialPrompt, taskCommitMessage } from './prompts';
import { holderOf, release } from './slots';

/** Initial invocations that failed to run are retried this many times before the drop. */
const MAX_INITIAL_RETRIES = 2;
/** Longest backoff between initial retries, seconds (`min(60, infra_retry_seconds * n)`). */
const MAX_RETRY_BACKOFF_SECONDS = 60;

/** A fresh `TaskState` for a task id. */
export function newTaskState(id: TaskId, selected: readonly string[]): TaskState {
  return {
    id,
    status: 'pending',
    agent: null,
    baseSha: null,
    headSha: null,
    mergedMain: null,
    sessionId: null,
    sessionResumable: false,
    startedAt: null,
    agentDoneAt: null,
    landedAt: null,
    greenAt: null,
    landedSha: null,
    writeSet: [],
    actualModules: [],
    invocations: [],
    conflicts: 0,
    reds: 0,
    reworks: 0,
    infraRetries: 0,
    dropReason: null,
    tamper: [],
    selected: [...selected],
  };
}

export function isTerminal(task: TaskState): boolean {
  return task.status === 'green' || task.status === 'dropped' || task.status === 'parked';
}

/**
 * Starts a task on a slot from `base` (`run_initial` up to the invocation): the initial
 * invocation goes to the slot at once. The bean needs no setup: it is the branch
 * `refs/heads/beans/<task>` of the run repo, created by the driver's first push.
 */
export function startTask(ctx: StepContext, slot: SlotState, id: TaskId, base: Sha): void {
  issueInitial(ctx, beginTask(ctx, slot, id, base));
}

/** Binds a task to a slot and its base and logs `task.start`; its first invocation is the caller's. */
export function beginTask(ctx: StepContext, slot: SlotState, id: TaskId, base: Sha): TaskState {
  const task = requireTask(ctx, id);
  // A pushed bean starts where its author forked the sprout, not where the sprout is now.
  const start = task.pushedBase ?? base;
  task.status = 'running';
  task.agent = slot.id;
  task.baseSha = start;
  task.mergedMain = start;
  task.startedAt ??= ctx.now;
  emit(ctx, 'task.start', { task: id, agent: slot.id, base: start, predicted: task.selected });
  return task;
}

/** Creates the task's initial invocation (again, after an agent that failed to run). */
export function issueInitial(ctx: StepContext, task: TaskState): void {
  if (!isRacing(ctx) || task.status !== 'running') return;
  const prompt = initialPrompt(promptTask(ctx, task.id));
  createInvocation(ctx, {
    kind: 'initial',
    task: task.id,
    slot: requireSlot(ctx, task.agent).id,
    attempt: task.infraRetries + 1,
    prompt,
    freshPrompt: prompt,
    resume: null,
    workspace: (inv) => taskWorkspace(ctx, task, { kind: 'initial', inv, merge: null }),
    replay: { reset_to: null, check: null, fixes: [] },
  });
}

/** How an invocation's workspace differs from the task's own state (v2.2 decisions). */
export type WorkspaceOptions = {
  readonly kind: InvocationKind;
  readonly inv: InvocationId;
  readonly merge: EngineWorkspace['merge'];
  /** Start from this commit instead of the task's base (a fresh fork of the sprout). */
  readonly base?: Sha;
  /** The bean's head; null starts the branch afresh at `base`. Default: the task's head. */
  readonly head?: Sha | null;
  /** Tests the driver writes on a fresh start and restores before committing. */
  readonly acceptance?: Readonly<Record<string, string>>;
  /** Landed tests the bean may change (amendments it carries, or a reconcile's): not protected. */
  readonly unprotect?: readonly string[];
};

/** The workspace of a task's invocation (protected tests by reference, read at delivery). */
export function taskWorkspace(
  ctx: StepContext,
  task: TaskState,
  options: WorkspaceOptions,
): StoredWorkspace {
  const definition = taskDefinition(ctx, task.id);
  const base = options.base ?? task.baseSha;
  if (base === null) throw new EngineInvariantError(`task ${task.id} has no base`);
  return {
    repoKey: task.id,
    branch: taskBranch(task.id),
    baseSha: base,
    headSha: options.head === undefined ? task.headSha : options.head,
    merge: options.merge,
    acceptance: options.acceptance ?? acceptanceTests(ctx, task.id),
    protect: protectedTests(ctx, task.id).filter(
      (file) => options.unprotect?.includes(file.path) !== true,
    ),
    unionPaths: unionPaths(ctx.env.config),
    commitMessage: taskCommitMessage(definition, options.kind, options.inv),
  };
}

/** The bean's branch in the run repo (`refs/heads/beans/<task>`). */
export function taskBranch(id: string): string {
  return `beans/${id}`;
}

/**
 * `--protect-tests landed`: every landed (and not dropped) task's acceptance tests except
 * the task's own, in task order, as references. The driver applies the lineage rule.
 */
export function protectedTests(ctx: StepContext, exclude: string): readonly ProtectedTestRef[] {
  if (protectTestsMode(ctx.env.config) !== 'landed') return [];
  return ctx.state.order.flatMap((id) => {
    const task = ctx.state.tasks[id];
    if (
      task === undefined ||
      id === exclude ||
      task.landedSha === null ||
      task.status === 'dropped'
    ) {
      return [];
    }
    return Object.keys(acceptanceTests(ctx, id)).map((path) => ({ task: id, path }));
  });
}

/**
 * The initial invocation reported (`run_initial` after `invoke`): an agent that failed to
 * run is retried with backoff, then dropped; otherwise the commit is recorded and the
 * policy takes the task on.
 */
export function onInitialResult(
  ctx: StepContext,
  inv: OpenInvocation,
  result: InvocationResult,
): void {
  const task = requireTask(ctx, inv.task);
  task.invocations.push(inv.id);
  const failure =
    result.infra_error ?? (result.head_sha === null ? 'driver reported no head_sha' : null);
  if (failure !== null) {
    retryOrDropInitial(ctx, task, failure);
    return;
  }
  task.sessionId = result.session_id;
  task.sessionResumable = isResumable(result);
  task.agentDoneAt = ctx.now;
  recordCommit(ctx, task, inv.id, 'initial', result);
  if (task.status === 'running') policyHooks(ctx).onInitialCommitted(task.id);
}

function retryOrDropInitial(ctx: StepContext, task: TaskState, failure: string): void {
  task.infraRetries += 1;
  if (task.infraRetries > MAX_INITIAL_RETRIES) {
    dropTask(ctx, task, `agent failed to run: ${failure.slice(0, 200)}`);
    return;
  }
  emit(ctx, 'invocation.retry', { task: task.id, reason: failure.slice(0, 300) });
  const backoff = Math.min(
    MAX_RETRY_BACKOFF_SECONDS,
    ctx.env.config.infra_retry_seconds * task.infraRetries,
  );
  setTimer(ctx, backoff, { kind: 'initial-retry', task: task.id });
}

/**
 * Logs the commit the driver made after an invocation (`commit_task`): restored acceptance
 * tests first, then the commit with the files it changed since the task's base.
 */
export function recordCommit(
  ctx: StepContext,
  task: TaskState,
  inv: InvocationId,
  kind: 'initial' | 'rework',
  result: InvocationResult,
): void {
  const acceptance = acceptanceTests(ctx, task.id);
  const isOwnTest = (path: string): boolean => Object.hasOwn(acceptance, path);
  if (result.tamper.length > 0) {
    task.tamper.push(...result.tamper);
    emit(ctx, 'acceptance.restored', {
      task: task.id,
      paths: result.tamper,
      inv,
      others: result.tamper.filter((path) => !isOwnTest(path)),
    });
  }
  const head = result.head_sha;
  if (head === null) throw new EngineInvariantError(`commit of ${task.id} without a head`);
  task.headSha = head;
  emit(ctx, 'task.commit', {
    task: task.id,
    sha: head,
    kind,
    new_commit: result.new_commit,
    files: result.files.filter((path) => !isOwnTest(path)),
  });
}

/** Drops a task (`Race.drop`) and frees the slot holding it. */
export function dropTask(ctx: StepContext, task: TaskState, reason: string): void {
  task.status = 'dropped';
  task.dropReason = reason;
  emit(ctx, 'task.drop', { task: task.id, reason });
  if (task.agent !== null && holderOf(ctx, task.id)?.id === task.agent) release(ctx, task.agent);
}

/**
 * Parks a task (v2 `park`): it needs a person, so the race stops working on it and finishes
 * without it. Like a drop it frees the slot holding it; unlike a drop it is not a failure of
 * the bean's work, and it does not ship.
 */
export function parkTask(ctx: StepContext, task: TaskState, reason: string): void {
  task.status = 'parked';
  task.parkedReason = reason;
  emit(ctx, 'task.parked', { task: task.id, reason });
  if (task.agent !== null && holderOf(ctx, task.id)?.id === task.agent) release(ctx, task.agent);
}

/** Records where a task landed and what it wrote (`record_landing`). */
export function recordLanding(
  ctx: StepContext,
  task: TaskState,
  sha: Sha,
  files: readonly string[],
): void {
  const acceptance = acceptanceTests(ctx, task.id);
  task.landedSha = sha;
  task.writeSet = [...files].toSorted();
  task.actualModules = [
    ...placementModules(files.filter((path) => !Object.hasOwn(acceptance, path))),
  ].toSorted();
}
