/**
 * The race engine: a deterministic state machine. `step(state, input)` applies one input
 * (a poll, a result, a runner outcome, a timer tick …) and returns the next state plus the
 * effects for the shell to perform. It never reads the clock, randomness or bindings, so
 * the same inputs always yield the same events.
 */
import type { InvocationResult } from '@beanstalk/shared-race/driver';
import type { InvocationId, Sha, SlotId } from '@beanstalk/shared-race/ids';

import { markAborted } from './abort';
import type { EngineEnv } from './catalog';
import { onCheckResult, onLatencyElapsed, pumpCi } from './ci';
import type { DecisionAnswer, StepContext } from './context';
import {
  createContext,
  dueTimers,
  emit,
  isRacing,
  policyHooks,
  requireSlot,
  requireTask,
  setTimer,
} from './context';
import { EngineInvariantError, assertNever } from './errors';
import { finishRun, onFinalCi, onFinalError, onFinalFiles } from './final-check';
import {
  closeWithResult,
  deliverPending,
  lostResult,
  recordProgress,
  rememberSession,
  retryAfterFailedResume,
} from './invocations';
import { beginShutdown, startRace } from './lifecycle';
import type {
  CiRun,
  EngineInput,
  EngineResponse,
  JobId,
  JobOutcome,
  JobRecord,
  OpenInvocation,
  RunLabels,
  TimerPurpose,
} from './model';
import { bindPolicy } from './policy';
import type { EngineState, StepOutput } from './state';
import { issueInitial, onInitialResult, recordCommit } from './tasks';

/**
 * Attempts per job before a retryable failure becomes fatal. Artifacts is eventually
 * consistent (a repo or object written moments ago may not be visible yet), so the
 * retries span about a minute.
 */
const MAX_JOB_ATTEMPTS = 6;
/** First retry delay for a failed job, doubled per attempt up to the cap. */
const JOB_RETRY_BASE_SECONDS = 2;
const JOB_RETRY_MAX_SECONDS = 30;

/**
 * Applies one input. Pure: the argument is cloned, never mutated. A thrown error is a bug;
 * the shell then applies a `fault` input to the previous state.
 */
export function step(state: EngineState, input: EngineInput, env: EngineEnv): StepOutput {
  const draft = structuredClone(state);
  const ctx = createContext(draft, input.at, env);
  ctx.hooks = bindPolicy(ctx);
  const response = handle(ctx, input);
  settle(ctx);
  return { state: draft, effects: ctx.effects, response };
}

function handle(ctx: StepContext, input: EngineInput): EngineResponse {
  switch (input.kind) {
    case 'start':
      return start(ctx, input.baseSha, input.labels);
    case 'stop':
      return stop(ctx, input.reason);
    case 'poll':
      return poll(ctx, input.slot, input.pollId);
    case 'poll-expired':
      return pollExpired(ctx, input.slot, input.pollId);
    case 'result':
      return result(ctx, input.slot, input.inv, input.result);
    case 'progress':
      return progress(ctx, input.slot, input.inv, input.costUsd);
    case 'job-done':
      jobDone(ctx, input.jobId, input.outcome);
      return { kind: 'none' };
    case 'tick':
      tick(ctx);
      return { kind: 'none' };
    case 'restart':
      restart(ctx);
      return { kind: 'none' };
    case 'decision':
      return decision(ctx, {
        card: input.card,
        winner: input.winner,
        actor: input.actor,
        text: input.text,
      });
    case 'fault':
      emit(ctx, 'error', { where: input.where, error: input.error, traceback: input.traceback });
      markAborted(ctx, `error in ${input.where}: ${input.error}`);
      return { kind: 'none' };
    default:
      return assertNever(input);
  }
}

/**
 * The main loop's turn after every wake-up: an abort or a finished race shuts down;
 * otherwise the policy dispatches work.
 */
function settle(ctx: StepContext): void {
  if (ctx.state.phase !== 'running') return;
  if (ctx.state.aborted === null) policyHooks(ctx).dispatch();
  if (ctx.state.aborted !== null || policyHooks(ctx).isFinished()) beginShutdown(ctx);
}

function start(ctx: StepContext, baseSha: Sha, labels: RunLabels): EngineResponse {
  if (ctx.state.phase !== 'created') return refused('invalid_state', `run is ${ctx.state.phase}`);
  startRace(ctx, baseSha, labels);
  for (const slot of ctx.state.slots) deliverPending(ctx, slot);
  return { kind: 'accepted' };
}

function stop(ctx: StepContext, reason: string): EngineResponse {
  if (ctx.state.phase === 'created') {
    ctx.state.aborted = reason;
    finishRun(ctx);
    return { kind: 'accepted' };
  }
  if (ctx.state.phase !== 'running') return refused('invalid_state', `run is ${ctx.state.phase}`);
  markAborted(ctx, reason);
  return { kind: 'accepted' };
}

/**
 * A slot asks for work. It holds the poll until an invocation is ready, the run ends or
 * the shell expires the poll; an older poll of the same slot is answered `wait`.
 */
function poll(ctx: StepContext, slotId: SlotId, pollId: string): EngineResponse {
  const slot = requireSlot(ctx, slotId);
  if (ctx.state.phase === 'done') {
    return { kind: 'poll', reply: { done: true, aborted: ctx.state.aborted } };
  }
  if (slot.pollId !== null && slot.pollId !== pollId) {
    ctx.effects.replies.push({ pollId: slot.pollId, reply: { wait: true } });
  }
  slot.pollId = pollId;
  deliverPending(ctx, slot);
  return { kind: 'poll', reply: null };
}

function pollExpired(ctx: StepContext, slotId: SlotId, pollId: string): EngineResponse {
  const slot = requireSlot(ctx, slotId);
  if (slot.pollId === pollId) {
    slot.pollId = null;
    ctx.effects.replies.push({ pollId, reply: { wait: true } });
  }
  return { kind: 'none' };
}

function result(
  ctx: StepContext,
  slotId: SlotId,
  invId: InvocationId,
  body: InvocationResult,
): EngineResponse {
  const inv = ctx.state.invocations[invId];
  if (inv === undefined) {
    return wasIssued(ctx, invId)
      ? refused('closed_invocation', `${invId} already ended`)
      : refused('unknown_invocation', `${invId} is not an invocation of this run`);
  }
  if (inv.slot !== slotId) return refused('wrong_slot', `${invId} belongs to slot ${inv.slot}`);
  if (inv.deliveredAt === null) return refused('invalid_state', `${invId} was never delivered`);
  finishInvocation(ctx, inv, body);
  return { kind: 'accepted' };
}

/** Ids count up from inv0001, so every id up to the counter was issued by this run. */
function wasIssued(ctx: StepContext, invId: InvocationId): boolean {
  const number = Number(/^inv(\d+)-/.exec(invId)?.[1] ?? Number.NaN);
  return number >= 1 && number <= ctx.state.counters.inv;
}

/** Closes an invocation and continues the flow that asked for it. */
function finishInvocation(ctx: StepContext, inv: OpenInvocation, body: InvocationResult): void {
  closeWithResult(ctx, inv, body);
  if (inv.kind === 'initial') {
    onInitialResult(ctx, inv, body);
    return;
  }
  const isCommitted =
    body.head_sha !== null && body.markers_left.length === 0 && body.subtype !== 'unresolved';
  // A test author's commit is not the task's work: the policy reads what it amended.
  if (inv.kind !== 'test-author' && !recordReworkCommit(ctx, { inv, body, isCommitted })) return;
  policyHooks(ctx).onReworkResult({
    inv: inv.id,
    kind: inv.kind,
    task: inv.task,
    slot: inv.slot,
    subtype: body.subtype,
    infraError: body.infra_error,
    markersLeft: body.markers_left,
    committed: isCommitted,
    headSha: body.head_sha,
    resultText: body.result_text,
  });
}

/**
 * The task's side of a rework (`invoke_rework` and `commit_task`): a failed resume is retried
 * fresh (false: the flow waits for that retry), else the session and the commit are recorded.
 */
function recordReworkCommit(
  ctx: StepContext,
  rework: { inv: OpenInvocation; body: InvocationResult; isCommitted: boolean },
): boolean {
  const { inv, body } = rework;
  const task = ctx.state.tasks[inv.task];
  task?.invocations.push(inv.id);
  if (retryAfterFailedResume(ctx, inv, body, task)) return false;
  if (task === undefined) return true;
  // A reconcile is a test author's fresh session on the bean: the bean keeps its own.
  if (inv.kind !== 'reconcile') rememberSession(task, body);
  if (rework.isCommitted) {
    recordCommit(ctx, task, inv.id, 'rework', body);
    task.mergedMain = inv.mergedLine ?? inv.workspace.merge?.sha ?? task.mergedMain;
  }
  return true;
}

/** A human answers a decision card (the admin route or the web app). */
function decision(ctx: StepContext, answer: DecisionAnswer): EngineResponse {
  if (!isRacing(ctx)) return refused('invalid_state', `run is ${ctx.state.phase}`);
  const refusal = policyHooks(ctx).onDecision(answer);
  return refusal === null ? { kind: 'accepted' } : { kind: 'refused', refusal };
}

function progress(
  ctx: StepContext,
  slotId: SlotId,
  invId: InvocationId,
  costUsd: number,
): EngineResponse {
  const inv = ctx.state.invocations[invId];
  if (inv === undefined) {
    const reason = ctx.state.aborted;
    return {
      kind: 'progress',
      response: reason === null ? { abort: false } : { abort: true, reason },
    };
  }
  if (inv.slot !== slotId) return refused('wrong_slot', `${invId} belongs to slot ${inv.slot}`);
  return { kind: 'progress', response: recordProgress(ctx, inv, costUsd) };
}

/**
 * A job finished. Retryable failures are retried with backoff; a failure that persists
 * aborts the race (or ends the final check with an error, as the harness records it).
 */
function jobDone(ctx: StepContext, jobId: JobId, outcome: JobOutcome): void {
  const record = ctx.state.jobs[jobId];
  if (record === undefined) return;
  if (!outcome.ok) {
    if (outcome.retryable && record.attempts < MAX_JOB_ATTEMPTS) {
      record.attempts += 1;
      setTimer(ctx, retryDelay(record.attempts), { kind: 'job-retry', jobId });
      return;
    }
    delete ctx.state.jobs[jobId];
    failJob(ctx, { jobId, record, error: outcome.error });
    return;
  }
  if (outcome.result.kind !== record.spec.kind) {
    throw new EngineInvariantError(
      `${record.spec.kind} job ${jobId} returned a ${outcome.result.kind} result`,
    );
  }
  delete ctx.state.jobs[jobId];
  routeJob(ctx, jobId, record, outcome);
  pumpCi(ctx);
}

function routeJob(
  ctx: StepContext,
  jobId: JobId,
  record: JobRecord,
  outcome: Extract<JobOutcome, { ok: true }>,
): void {
  const owner = record.owner;
  const jobResult = outcome.result;
  switch (owner.kind) {
    case 'ci': {
      if (jobResult.kind !== 'check') return;
      const run = onCheckResult(ctx, owner.ciId, jobResult.check);
      if (run !== null) routeCi(ctx, run);
      return;
    }
    case 'final':
      if (jobResult.kind === 'read-files') onFinalFiles(ctx, jobResult.contents);
      return;
    case 'policy':
      if (isRacing(ctx)) policyHooks(ctx).onJobDone(jobId, jobResult);
      return;
    default:
      assertNever(owner);
  }
}

function routeCi(ctx: StepContext, run: CiRun): void {
  if (run.owner === 'final') {
    onFinalCi(ctx, run);
    return;
  }
  if (run.result !== null && isRacing(ctx)) policyHooks(ctx).onCiDone(run.id, run.result);
}

/** Seconds before retry `attempt` of a failed job. */
function retryDelay(attempt: number): number {
  return Math.min(JOB_RETRY_MAX_SECONDS, JOB_RETRY_BASE_SECONDS * 2 ** (attempt - 2));
}

/**
 * A job failed for good. The final check records the error; a policy contains a failure
 * of one task's work by dropping that task; anything else aborts the race.
 */
function failJob(
  ctx: StepContext,
  failure: { jobId: JobId; record: JobRecord; error: string },
): void {
  const { record } = failure;
  const message = `${record.spec.kind} failed: ${failure.error}`;
  const isFinalCheck =
    record.owner.kind === 'final' ||
    (record.owner.kind === 'ci' && ctx.state.phase === 'finishing');
  if (isFinalCheck) {
    onFinalError(ctx, message);
    return;
  }
  const isContained =
    record.owner.kind === 'policy' &&
    isRacing(ctx) &&
    policyHooks(ctx).onJobFailed(failure.jobId, message);
  if (!isContained) markAborted(ctx, message);
}

/** Fires every due timer in order; a timer cancelled by an earlier one does not fire. */
function tick(ctx: StepContext): void {
  for (const [id, due] of dueTimers(ctx.state, ctx.now)) {
    if (ctx.state.timers[id] === undefined) continue;
    delete ctx.state.timers[id];
    fire(ctx, due.purpose);
  }
  pumpCi(ctx);
}

function fire(ctx: StepContext, purpose: TimerPurpose): void {
  switch (purpose.kind) {
    case 'ci-latency': {
      const run = onLatencyElapsed(ctx, purpose.ciId);
      if (run !== null) routeCi(ctx, run);
      return;
    }
    case 'initial-retry':
      issueInitial(ctx, requireTask(ctx, purpose.task));
      return;
    case 'job-retry':
      reissueJob(ctx, purpose.jobId);
      return;
    case 'wall-clock':
      markAborted(ctx, `wall-clock limit of ${ctx.env.config.max_wall_minutes} minutes`);
      return;
    case 'watchdog':
      expireInvocation(ctx, purpose.inv);
      return;
    case 'policy':
      if (isRacing(ctx)) policyHooks(ctx).onTimer(purpose.key);
      return;
    default:
      assertNever(purpose);
  }
}

function reissueJob(ctx: StepContext, jobId: JobId): void {
  const record = ctx.state.jobs[jobId];
  if (record !== undefined) ctx.effects.jobs.push({ id: jobId, spec: record.spec });
}

/** The driver never reported: close the invocation as a lost agent. */
function expireInvocation(ctx: StepContext, invId: InvocationId): void {
  const inv = ctx.state.invocations[invId];
  if (inv === undefined || inv.deliveredAt === null) return;
  inv.watchdog = null;
  finishInvocation(ctx, inv, lostResult(ctx, inv));
}

/**
 * The shell restarted (deploy or eviction): open polls died with it, and the jobs it was
 * running are issued again (squash, check and push-with-lease are safe to repeat).
 */
function restart(ctx: StepContext): void {
  for (const slot of ctx.state.slots) slot.pollId = null;
  for (const [id, record] of Object.entries(ctx.state.jobs)) {
    if (isJobId(id)) ctx.effects.jobs.push({ id, spec: record.spec });
  }
}

function isJobId(id: string): id is JobId {
  return id.startsWith('job');
}

function refused(
  code: Extract<EngineResponse, { kind: 'refused' }>['refusal']['code'],
  message: string,
): EngineResponse {
  return { kind: 'refused', refusal: { code, message } };
}
