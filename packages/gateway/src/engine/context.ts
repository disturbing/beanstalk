import type { InvocationKind } from '@beanstalk/shared-race/driver';
import type { RaceEventFields, RaceEventType } from '@beanstalk/shared-race/events';
import type { InvocationId, Sha, SlotId, TaskId } from '@beanstalk/shared-race/ids';
import type { ArenaTask } from '@beanstalk/shared-race/task';

import type { EngineEnv } from './catalog';
import { EngineInvariantError } from './errors';
import type {
  CheckResult,
  CiId,
  Effects,
  EngineRefusal,
  EngineReply,
  JobId,
  JobOwner,
  JobResult,
  JobSpec,
  Seconds,
  SlotActivity,
  SlotState,
  TaskState,
  TimerId,
  TimerPurpose,
  TimerRecord,
} from './model';
import { isoTimestamp, roundTo } from './numbers';
import type { EngineState } from './state';

/** A rework or fixer invocation's outcome, handed to the policy that asked for it. */
export type ReworkOutcome = {
  readonly inv: InvocationId;
  readonly kind: InvocationKind;
  readonly task: string;
  readonly slot: SlotId;
  readonly subtype: string | null;
  readonly infraError: string | null;
  readonly markersLeft: readonly string[];
  /** The driver committed and pushed (no markers left, not unresolved). */
  readonly committed: boolean;
  /** The commit the driver pushed, if any. */
  readonly headSha: Sha | null;
  /** The agent's final message (a reconcile's verdict line). */
  readonly resultText: string;
  /** Files the pushed commit changed since the workspace's base (a tests-first author's tests). */
  readonly files: readonly string[];
};

/** An answer to a decision card. */
export type DecisionAnswer = {
  readonly card: string;
  readonly winner: string;
  readonly actor: string;
  readonly text: string | null;
};

/**
 * What the core asks of the running policy. The engine binds these to the policy's state
 * at the start of every step, so core modules never import a policy.
 */
export type PolicyHooks = {
  dispatch(): void;
  onInitialCommitted(task: TaskId): void;
  onReworkResult(outcome: ReworkOutcome): void;
  onJobDone(jobId: JobId, result: JobResult): void;
  /**
   * A job of the policy failed for good. True when the policy contained the failure (it
   * concerned one task's work, and that task was dropped); false aborts the race.
   */
  onJobFailed(jobId: JobId, error: string): boolean;
  onCiDone(ciId: CiId, result: CheckResult): void;
  onTimer(key: string): void;
  /** An answer to a decision card; a refusal when there is no such open card or winner. */
  onDecision(answer: DecisionAnswer): EngineRefusal | null;
  isFinished(): boolean;
  /** The newest validated commit (`final_green_sha`). */
  finalGreenSha(): Sha;
};

/** One step's working set: the draft state, the effects so far and the bound policy. */
export type StepContext = {
  readonly atMs: number;
  readonly now: Seconds;
  readonly env: EngineEnv;
  readonly state: EngineState;
  readonly effects: Effects;
  hooks: PolicyHooks | null;
};

/** Creates the context for one step; `now` never goes backwards. */
export function createContext(state: EngineState, atMs: number, env: EngineEnv): StepContext {
  const now = Math.max(state.clock, (atMs - state.createdAtMs) / 1000);
  state.clock = now;
  return { atMs, now, env, state, effects: { events: [], replies: [], jobs: [] }, hooks: null };
}

/**
 * Appends an event (`Race.log`): slot clocks are brought up to date first, exactly as the
 * harness refreshes its agents on every log line.
 */
export function emit<K extends RaceEventType>(
  ctx: StepContext,
  type: K,
  fields: RaceEventFields[K],
): void {
  refreshSlotClocks(ctx);
  ctx.state.seq += 1;
  ctx.effects.events.push({
    seq: ctx.state.seq,
    t: roundTo(ctx.now, 3),
    ts: isoTimestamp(ctx.atMs),
    type,
    ...fields,
  });
}

/** `refresh_agents`: busy while running, blocked while holding work (or paused), else idle. */
export function refreshSlotClocks(ctx: StepContext): void {
  const hasWaitingWork =
    ctx.state.paused && Object.values(ctx.state.tasks).some((task) => task.status === 'pending');
  for (const slot of ctx.state.slots) {
    const next = slotActivity(slot, hasWaitingWork);
    if (next === slot.state) continue;
    slot.totals[slot.state] += ctx.now - slot.since;
    slot.state = next;
    slot.since = ctx.now;
  }
}

function slotActivity(slot: SlotState, hasWaitingWork: boolean): SlotActivity {
  if (slot.running !== null) return 'busy';
  if (slot.holding !== null || hasWaitingWork) return 'blocked';
  return 'idle';
}

/** Answers a held long poll. */
export function reply(ctx: StepContext, pollId: string, response: EngineReply): void {
  ctx.effects.replies.push({ pollId, reply: response });
}

/** Asks the shell to run a job; its outcome comes back as a `job-done` input. */
export function startJob(ctx: StepContext, spec: JobSpec, owner: JobOwner): JobId {
  ctx.state.counters.job += 1;
  const id: JobId = `job${ctx.state.counters.job}`;
  ctx.state.jobs[id] = { spec, owner, attempts: 1 };
  ctx.effects.jobs.push({ id, spec });
  return id;
}

/** Schedules a timer `delay` seconds from now. */
export function setTimer(ctx: StepContext, delay: Seconds, purpose: TimerPurpose): TimerId {
  ctx.state.counters.timer += 1;
  const id: TimerId = `tm${ctx.state.counters.timer}`;
  ctx.state.timers[id] = { at: ctx.now + Math.max(0, delay), purpose };
  return id;
}

export function cancelTimer(ctx: StepContext, id: TimerId | null): void {
  if (id !== null) delete ctx.state.timers[id];
}

/**
 * Slack when deciding that a timer is due. Times are float seconds, so a timer set for
 * `now + 60` can land a hair after the millisecond the shell wakes up for it; without the
 * slack that wake-up would fire nothing and the timer would wait for the next one.
 */
const DUE_SLACK_SECONDS = 1e-6;

/** Timers due at `now`, earliest first (ties in creation order). */
export function dueTimers(state: EngineState, now: Seconds): [TimerId, TimerRecord][] {
  const due: [TimerId, TimerRecord][] = [];
  for (const [id, timer] of Object.entries(state.timers)) {
    if (timer.at <= now + DUE_SLACK_SECONDS && isTimerId(id)) due.push([id, timer]);
  }
  return due.toSorted(([a, x], [b, y]) => x.at - y.at || timerNumber(a) - timerNumber(b));
}

function isTimerId(id: string): id is TimerId {
  return id.startsWith('tm');
}

function timerNumber(id: TimerId): number {
  return Number(id.slice(2));
}

/** The next invocation id (`inv0007-rework`), counted across kinds as the harness does. */
export function nextInvocationId(ctx: StepContext, kind: InvocationKind): InvocationId {
  ctx.state.counters.inv += 1;
  return `inv${String(ctx.state.counters.inv).padStart(4, '0')}-${kind}`;
}

/** The bound policy; only valid once the race has started. */
export function policyHooks(ctx: StepContext): PolicyHooks {
  if (ctx.hooks === null) throw new EngineInvariantError('policy used before the race started');
  return ctx.hooks;
}

export function requireTask(ctx: StepContext, id: string): TaskState {
  const task = ctx.state.tasks[id];
  if (task === undefined) throw new EngineInvariantError(`unknown task ${id}`);
  return task;
}

export function taskDefinition(ctx: StepContext, id: string): ArenaTask {
  const task = ctx.env.tasks.get(id);
  if (task === undefined) throw new EngineInvariantError(`task ${id} is not in the run config`);
  return task;
}

/**
 * A task's effective acceptance tests: its own (or, v2.5, the ones its tests-first author
 * proved, which replace them), with any spec amendment a decision recorded (v2.2). An
 * amendment only changes contents, never paths.
 */
export function acceptanceTests(ctx: StepContext, id: string): Readonly<Record<string, string>> {
  taskDefinition(ctx, id);
  return effectiveTests(ctx.env, ctx.state, id);
}

/** `acceptanceTests` outside a step (the shell's views). */
export function effectiveTests(
  env: EngineEnv,
  state: EngineState,
  id: string,
): Readonly<Record<string, string>> {
  const tests = state.authoredTests[id] ?? env.tasks.get(id)?.acceptance_tests ?? {};
  const amended = state.amendedTests[id];
  return amended === undefined ? tests : { ...tests, ...amended };
}

/** The task as its prompts name it: its definition with its effective acceptance tests. */
export function promptTask(ctx: StepContext, id: string): ArenaTask {
  return { ...taskDefinition(ctx, id), acceptance_tests: { ...acceptanceTests(ctx, id) } };
}

export function requireSlot(ctx: StepContext, id: string | null): SlotState {
  const slot = ctx.state.slots.find((candidate) => candidate.id === id);
  if (slot === undefined) throw new EngineInvariantError(`unknown slot ${String(id)}`);
  return slot;
}

/** Whether the run accepts new work (started, not aborted, not shutting down). */
export function isRacing(ctx: StepContext): boolean {
  return ctx.state.phase === 'running' && ctx.state.aborted === null;
}
