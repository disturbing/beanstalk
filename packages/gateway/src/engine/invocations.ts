import type {
  InvocationKind,
  InvocationResult,
  ProgressResponse,
  ReplayHints,
} from '@beanstalk/shared-race/driver';
import type { InvocationEndFields, Json } from '@beanstalk/shared-race/events';
import type { InvocationId, Sha, SlotId } from '@beanstalk/shared-race/ids';

import { budgetMessage, markAborted } from './abort';
import type { StepContext } from './context';
import {
  cancelTimer,
  emit,
  isRacing,
  nextInvocationId,
  reply,
  requireSlot,
  setTimer,
} from './context';
import type {
  EngineInstruction,
  EngineWorkspace,
  InvocationStats,
  OpenInvocation,
  SlotState,
  TaskState,
} from './model';
import { roundTo } from './numbers';
import type { EngineState } from './state';

/** Time after the agent's own timeout for the driver to commit, push and report. */
const WATCHDOG_GRACE_SECONDS = 300;
/** Characters of the agent's final message kept in `invocation.end` (`to_event`). */
const RESULT_TEXT_CHARS = 600;

export type InvocationSpec = {
  readonly kind: InvocationKind;
  readonly task: string;
  readonly slot: SlotId;
  readonly attempt: number;
  readonly prompt: string;
  readonly freshPrompt: string;
  readonly resume: string | null;
  /** Built once the invocation id is known (it is part of the commit message). */
  readonly workspace: (inv: InvocationId) => EngineWorkspace;
  readonly replay: ReplayHints;
  /** The landed-line commit the merge brings in, when it is not `merge.sha` itself. */
  readonly mergedLine?: Sha;
};

/** Spent plus the running estimates of invocations still in flight (`committed_cost`). */
export function committedCost(state: EngineState): number {
  return state.spent + Object.values(state.inflightCost).reduce((sum, cost) => sum + cost, 0);
}

/**
 * Creates an invocation for a slot; the slot's open poll receives it now, or its next poll
 * does. Returns null once the race no longer accepts work.
 */
export function createInvocation(ctx: StepContext, spec: InvocationSpec): InvocationId | null {
  if (!isRacing(ctx)) return null;
  const id = nextInvocationId(ctx, spec.kind);
  const slot = requireSlot(ctx, spec.slot);
  ctx.state.invocations[id] = {
    id,
    kind: spec.kind,
    task: spec.task,
    slot: spec.slot,
    attempt: spec.attempt,
    prompt: spec.prompt,
    freshPrompt: spec.freshPrompt,
    resume: spec.resume,
    workspace: spec.workspace(id),
    replay: spec.replay,
    mergedLine: spec.mergedLine ?? null,
    createdAt: ctx.now,
    deliveredAt: null,
    budgetCapUsd: null,
    watchdog: null,
  };
  slot.outbox = id;
  deliverPending(ctx, slot);
  return id;
}

/**
 * Hands a slot's pending invocation to its open poll. The budget is checked first, as
 * `Race.invoke` does before an agent starts; an exhausted budget aborts the race instead.
 */
export function deliverPending(ctx: StepContext, slot: SlotState): void {
  if (slot.outbox === null || slot.pollId === null || !isRacing(ctx)) return;
  const inv = ctx.state.invocations[slot.outbox];
  if (inv === undefined) {
    slot.outbox = null;
    return;
  }
  const budget = ctx.env.config.budget_usd;
  if (committedCost(ctx.state) >= budget) {
    markAborted(ctx, budgetMessage(committedCost(ctx.state), budget));
    return;
  }
  inv.budgetCapUsd = Math.min(ctx.env.config.max_invocation_usd, budget - committedCost(ctx.state));
  inv.deliveredAt = ctx.now;
  slot.outbox = null;
  slot.running = inv.id;
  ctx.state.inflightCost[inv.id] = 0;
  emitStart(ctx, inv);
  inv.watchdog = setTimer(ctx, ctx.env.config.agent_timeout + WATCHDOG_GRACE_SECONDS, {
    kind: 'watchdog',
    inv: inv.id,
  });
  reply(ctx, slot.pollId, { invocation: toInstruction(ctx, inv) });
  slot.pollId = null;
}

function emitStart(ctx: StepContext, inv: OpenInvocation): void {
  emit(ctx, 'invocation.start', {
    inv: inv.id,
    kind: inv.kind,
    task: inv.task,
    agent: inv.slot,
    adapter: ctx.env.config.agent,
    model: ctx.env.config.model,
    attempt: inv.attempt,
    resume: inv.resume,
    cwd: `work/agents/${inv.task}`,
    budget_cap_usd: roundTo(inv.budgetCapUsd ?? 0, 4),
  });
}

/** The instruction the driver receives for an invocation. */
export function toInstruction(ctx: StepContext, inv: OpenInvocation): EngineInstruction {
  const config = ctx.env.config;
  return {
    inv: inv.id,
    kind: inv.kind,
    task: inv.task,
    slot: inv.slot,
    attempt: inv.attempt,
    prompt: inv.prompt,
    resume: inv.resume,
    adapter: config.agent,
    model: config.model,
    max_turns: config.max_turns,
    timeout_seconds: config.agent_timeout,
    budget_cap_usd: roundTo(inv.budgetCapUsd ?? 0, 4),
    workspace: inv.workspace,
    replay: inv.replay,
  };
}

/**
 * Closes an invocation with the driver's result (`Race.invoke` after the adapter returns):
 * charges its cost, logs `invocation.end` and `invocation.init`, then aborts the race when
 * the budget is spent or the agent hit a hard rate limit.
 */
export function closeWithResult(
  ctx: StepContext,
  inv: OpenInvocation,
  result: InvocationResult,
): void {
  const slot = requireSlot(ctx, inv.slot);
  if (slot.running === inv.id) slot.running = null;
  if (slot.outbox === inv.id) slot.outbox = null;
  cancelTimer(ctx, inv.watchdog);
  delete ctx.state.inflightCost[inv.id];
  delete ctx.state.invocations[inv.id];
  ctx.state.spent += result.cost_usd;
  addStats(ctx.state, inv.kind, result);
  emit(ctx, 'invocation.end', {
    inv: inv.id,
    kind: inv.kind,
    task: inv.task,
    agent: inv.slot,
    spent_usd: roundTo(ctx.state.spent, 4),
    ...invocationEndFields(result),
  });
  if (Object.keys(result.init).length > 0) {
    emit(ctx, 'invocation.init', { inv: inv.id, ...jsonRecord(result.init) });
  }
  recordInvocation(ctx.state, inv, result);
  abortIfOverBudgetOrLimited(ctx, result);
}

function abortIfOverBudgetOrLimited(ctx: StepContext, result: InvocationResult): void {
  const budget = ctx.env.config.budget_usd;
  if (ctx.state.spent >= budget) markAborted(ctx, budgetMessage(ctx.state.spent, budget));
  if (result.rate_limited) {
    const limit = result.rate_limit ?? {};
    markAborted(
      ctx,
      `rate limited (${pythonValue(limit['rateLimitType'])}, resets at ${pythonValue(limit['resetsAt'])}): ` +
        'stopping rather than dropping tasks',
    );
  }
}

function pythonValue(value: unknown): string {
  if (value === undefined || value === null) return 'None';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** `InvocationResult.to_event()` without the ids, in the dataclass's field order. */
function invocationEndFields(
  result: InvocationResult,
): Omit<InvocationEndFields, 'inv' | 'kind' | 'task' | 'agent' | 'spent_usd'> {
  return {
    ok: result.ok,
    infra_error: result.infra_error,
    timed_out: result.timed_out,
    exit_code: result.exit_code,
    subtype: result.subtype,
    is_error: result.is_error,
    cost_usd: result.cost_usd,
    cost_source: result.cost_source,
    num_turns: result.num_turns,
    duration_ms: result.duration_ms,
    duration_api_ms: result.duration_api_ms,
    wall_ms: result.wall_ms,
    startup_ms: result.startup_ms,
    session_id: result.session_id,
    usage: result.usage,
    model_usage: jsonRecord(result.model_usage),
    permission_denials: result.permission_denials.map(toJson),
    tool_uses: result.tool_uses,
    result_text: result.result_text.slice(0, RESULT_TEXT_CHARS),
    structured_output: toJson(result.structured_output),
    transcript: result.transcript,
    notes: result.notes,
    rate_limit: result.rate_limit === null ? null : jsonRecord(result.rate_limit),
    rate_limited: result.rate_limited,
  };
}

/** Narrows a parsed JSON value (from a validated request body) to the event's Json type. */
function toJson(value: unknown): Json {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(toJson);
  if (typeof value === 'object') return jsonRecord(value);
  return null;
}

function jsonRecord(value: object): Record<string, Json> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJson(item)]));
}

function addStats(state: EngineState, kind: string, result: InvocationResult): void {
  const stats: InvocationStats = state.invStats[kind] ?? emptyStats();
  stats.count += 1;
  stats.cost_usd += result.cost_usd;
  stats.turns += result.num_turns ?? 0;
  stats.wall_s += result.wall_ms / 1000;
  stats.input_tokens += Math.trunc(result.usage['input_tokens'] ?? 0);
  stats.output_tokens += Math.trunc(result.usage['output_tokens'] ?? 0);
  stats.cache_read_input_tokens += Math.trunc(result.usage['cache_read_input_tokens'] ?? 0);
  stats.cache_creation_input_tokens += Math.trunc(result.usage['cache_creation_input_tokens'] ?? 0);
  stats.infra_errors += result.infra_error === null ? 0 : 1;
  stats.timeouts += result.timed_out ? 1 : 0;
  stats.estimated_cost += result.cost_source === 'estimated' ? 1 : 0;
  state.invStats[kind] = stats;
}

function emptyStats(): InvocationStats {
  return {
    count: 0,
    cost_usd: 0,
    turns: 0,
    wall_s: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    infra_errors: 0,
    timeouts: 0,
    estimated_cost: 0,
  };
}

function recordInvocation(state: EngineState, inv: OpenInvocation, result: InvocationResult): void {
  const rateLimit = result.rate_limit;
  state.invRecords.push({
    inv: inv.id,
    kind: inv.kind,
    task: inv.task,
    costUsd: result.cost_usd,
    turns: result.num_turns,
    wallMs: result.wall_ms,
    durationApiMs: result.duration_api_ms,
    startupMs: result.startup_ms,
    subtype: result.subtype,
    infraError: result.infra_error,
    overage: rateLimit !== null && rateLimit['isUsingOverage'] === true,
    rateLimit: rateLimit === null ? null : jsonRecord(rateLimit),
  });
}

/**
 * Ends every delivered invocation as killed at shutdown, charging its last reported
 * estimate (the harness's CancelledError path). Undelivered ones never started and vanish.
 * Returns how many were killed.
 */
export function killOpenInvocations(ctx: StepContext): number {
  const open = Object.values(ctx.state.invocations).toSorted((a, b) => a.id.localeCompare(b.id));
  let killed = 0;
  for (const inv of open) {
    delete ctx.state.invocations[inv.id];
    const slot = requireSlot(ctx, inv.slot);
    if (slot.outbox === inv.id) slot.outbox = null;
    if (inv.deliveredAt === null) continue;
    const estimate = ctx.state.inflightCost[inv.id] ?? 0;
    delete ctx.state.inflightCost[inv.id];
    if (slot.running === inv.id) slot.running = null;
    cancelTimer(ctx, inv.watchdog);
    ctx.state.spent += estimate;
    killed += 1;
    emit(ctx, 'invocation.end', {
      inv: inv.id,
      kind: inv.kind,
      task: inv.task,
      agent: inv.slot,
      ok: false,
      killed: true,
      cost_usd: roundTo(estimate, 6),
      cost_source: estimate > 0 ? 'estimated' : 'none',
      spent_usd: roundTo(ctx.state.spent, 4),
    });
  }
  return killed;
}

/**
 * A running cost estimate from the driver (the adapter's `progress` callback): aborts the
 * race when it would take the committed cost over the budget, and tells the driver.
 */
export function recordProgress(
  ctx: StepContext,
  inv: OpenInvocation,
  estimateUsd: number,
): ProgressResponse {
  if (inv.deliveredAt !== null && isRacing(ctx)) {
    ctx.state.inflightCost[inv.id] = estimateUsd;
    const budget = ctx.env.config.budget_usd;
    const committed = committedCost(ctx.state);
    if (committed >= budget)
      markAborted(ctx, `${budgetMessage(committed, budget)} (mid-invocation)`);
  }
  const aborted = ctx.state.aborted;
  return aborted === null ? { abort: false } : { abort: true, reason: aborted };
}

/**
 * `invoke_rework`: a rework that resumed the author's session and failed to run is retried
 * once, at once, as a fresh session with the full prompt. Returns true when it retried.
 */
export function retryAfterFailedResume(
  ctx: StepContext,
  inv: OpenInvocation,
  result: InvocationResult,
  task: TaskState | undefined,
): boolean {
  const resumeFailed =
    result.infra_error !== null && inv.resume !== null && !result.rate_limited && isRacing(ctx);
  if (!resumeFailed) return false;
  if (task !== undefined) {
    task.sessionId = null;
    task.sessionResumable = false;
  }
  emit(ctx, 'invocation.retry', {
    task: inv.task,
    reason: `resume failed: ${(result.infra_error ?? '').slice(0, 200)}`,
  });
  createInvocation(ctx, {
    kind: inv.kind,
    task: inv.task,
    slot: inv.slot,
    attempt: inv.attempt,
    prompt: inv.freshPrompt,
    freshPrompt: inv.freshPrompt,
    resume: null,
    workspace: () => inv.workspace,
    replay: inv.replay,
    ...(inv.mergedLine === null ? {} : { mergedLine: inv.mergedLine }),
  });
  return true;
}

/**
 * Whether a rework may resume the author's session (`can_resume`): only Claude Code
 * sessions, and only when the last invocation of that session reported its cost.
 */
export function canResume(ctx: StepContext, task: TaskState): boolean {
  const config = ctx.env.config;
  return (
    config.rework_resume &&
    config.agent === 'claude' &&
    task.sessionId !== null &&
    task.sessionResumable
  );
}

/** Records the session a successful invocation reported, for later resumes. */
export function rememberSession(task: TaskState, result: InvocationResult): void {
  if (result.session_id === null || result.infra_error !== null) return;
  task.sessionId = result.session_id;
  task.sessionResumable = isResumable(result);
}

/**
 * The adapter's `resumable(session)`: a session can be resumed when its last invocation
 * reported a cumulative cost (Claude Code's `total_cost_usd`).
 */
export function isResumable(result: InvocationResult): boolean {
  return result.session_id !== null && result.cost_source.startsWith('reported');
}

/**
 * The result of an invocation whose driver went silent past the agent timeout: an infra
 * error, charged with the last estimate, so the task flows treat it like a crashed agent.
 */
export function lostResult(ctx: StepContext, inv: OpenInvocation): InvocationResult {
  const estimate = ctx.state.inflightCost[inv.id] ?? 0;
  const waited = Math.round(ctx.env.config.agent_timeout + WATCHDOG_GRACE_SECONDS);
  return {
    ok: false,
    infra_error: `lost: no result from the driver within ${waited} s`,
    timed_out: true,
    exit_code: null,
    subtype: null,
    is_error: false,
    cost_usd: estimate,
    cost_source: estimate > 0 ? 'estimated' : 'none',
    num_turns: null,
    duration_ms: null,
    duration_api_ms: null,
    wall_ms: Math.round((ctx.now - (inv.deliveredAt ?? ctx.now)) * 1000),
    startup_ms: null,
    session_id: null,
    usage: {},
    model_usage: {},
    permission_denials: [],
    tool_uses: {},
    result_text: '',
    structured_output: null,
    transcript: null,
    notes: [],
    rate_limit: null,
    rate_limited: false,
    init: {},
    pushed_ref: null,
    head_sha: null,
    new_commit: false,
    files: [],
    tamper: [],
    markers_left: [],
    merge_conflicts: null,
  };
}
