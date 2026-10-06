/**
 * The v2 policy (plan §6, the product), ported from `policy_beanstalk_v2.py` on top of
 * `policy_beanstalk_preland.py` (optimistic mode) and `policy_beanstalk.py`, with the v2.2
 * rules the experiments validated (`docs/claude-opus/11-experiments-summary.md`):
 *
 * 1. Beans start first-in, first-out from the sprout head, or dependency-aware (`v2-start-order`).
 * 2-3. Each bean is checked on its agent's sandbox and lands optimistically, while the sprout
 *    window has room (v2.3, `v2-backpressure`); a moved sprout forces a re-check only by the
 *    `recheck` rule (v2.3: sampled; v2.2: adaptive) (`v2-landing`).
 *    With `release_on_check` (v2.2) the agent takes the next task meanwhile (`v2-agents`).
 * 4-5. Red checks go back to the author with the culprits' context; a stuck pair becomes a
 *    decision card, whose loser is re-executed under the decided spec (v2.2) or declined
 *    (`v2-repair`, `v2-decisions`, `v2-amendments`).
 * 6. The sprout is validated asynchronously and promoted to the stalk; a red validation is
 *    confirmed by the same failing test (v2.2) and reverted, never fixed forward
 *    (`v2-validator`, `v2-tickets`).
 * 7. Landed acceptance tests are protected (`protect_tests: landed`, by the driver).
 */
import type { Json } from '@beanstalk/shared-race/events';
import type { V2PolicyView } from '@beanstalk/shared-race/rpc';
import type { SlotId } from '@beanstalk/shared-race/ids';
import {
  prelandSeconds,
  releasesOnCheck,
  usesStructuralMerge,
} from '@beanstalk/shared-race/run-config';

import type { PolicyHooks, ReworkOutcome, StepContext } from '../context';
import { emit, requireTask } from '../context';
import { EngineInvariantError, assertNever } from '../errors';
import type { CheckResult, CiId, JobId, JobResult } from '../model';
import { pythonCounts, pythonFloat, roundTo } from '../numbers';
import type { PolicyModule, PolicySummary } from '../policy-module';
import { freeAskingSlot, hold } from '../slots';
import { isTerminal, startTask } from '../tasks';
import { assignAgents } from './v2-agents';
import {
  onTestsFirstDone,
  onTestsFirstElapsed,
  onTestsFirstJob,
  onTestsFirstJobFailed,
  startTestsFirst,
} from './v2-tests-first';
import {
  answerCard,
  hasPendingCards,
  onAuthorDone,
  onCardJob,
  onCardJobFailed,
  onFailFirstElapsed,
  onOracle,
  startAdoptRework,
  startAuthor,
  startReexecution,
} from './v2-decisions';
import { parseTimerKey } from './v2-flows';
import { onReconcileDone, startReconcile } from './v2-reconcile';
import {
  admitWaiting,
  attempt,
  onLandingJob,
  onLandingJobFailed,
  onLandingTurn,
  onLatencyElapsed,
  onReworkDone,
  startLanding,
  wakeInherited,
} from './v2-landing';
import {
  onCulpritDiff,
  onCulpritDiffFailed,
  startConflictRework,
  startInformedRework,
} from './v2-repair';
import { startRescue } from './v2-rescue';
import { takeWait } from './v2-sprout';
import { openStartCard, startUnderCard } from './v2-start';
import { chooseStart } from './v2-start-order';
import { midrunOffer, onMidrunSyncs } from './v2-midrun';
import { onSyncDone } from './v2-sync';
import type { LandingFlow, TurnHolder, V2Settings, V2State, V2Step, V2Wait } from './v2-state';
import {
  activeTickets,
  onLeaveOneOutBuilt,
  onLeaveOneOutChecked,
  onProbe,
  onRevertTurn,
  onTicketRevertJob,
} from './v2-tickets';
import { isTurnIdle } from './v2-turn';
import {
  isStalkSettled,
  maybeValidate,
  onConfirmed,
  onStalkJob,
  onValidated,
} from './v2-validator';

const V20_VARIANT_ROW = 'v2: pre-land check, informed author repair, decision cards, revert-first';
const V22_VARIANT_ROW =
  'v2.2: pre-land check, adaptive re-check, agent released during checks, ' +
  'flake-confirmed revert-first, inherited reds waited out, cards that re-execute the loser';
const V23_VARIANT_ROW =
  'v2.3: pre-land check, sprout window, sampled re-check, agent released during checks, ' +
  'read-set inherited reds, early revert-first, cards that re-execute the loser';
const V24_VARIANT_ROW =
  'v2.4: v2.3, with clashing tests reconciled before a card and stale reds re-checked';
const V25_VARIANT_ROW =
  'v2.5: v2.4, with escalation after one repeated red, every landed party reconciled, ' +
  'lone suspects reverted at once, base and dynamic culprits, a wider window, ' +
  'structural merges, start cards and one rescue';
/** How the variant row names each opt-in track. */
const ADDITION_ROWS: Readonly<Record<string, string>> = {
  tests_first: 'tests first',
  targeted_landing_check: 'targeted landing check',
  'start_order:dependency': 'dependency-aware starts',
  'live_sync:overlap': 'live sync of overlapping beans',
  'live_sync:all': 'live sync of every bean',
  live_sync_midrun: 'mid-run live sync',
};

export const v2Policy: PolicyModule<V2State> = {
  name: 'beanstalk-v2',
  init: initialV2State,
  hooks: v2Hooks,
  summary: v2Summary,
  view: v2View,
};

function initialV2State(ctx: StepContext): V2State {
  const base = ctx.state.baseSha;
  if (base === null) throw new EngineInvariantError('v2 starts from a base commit');
  const config = ctx.env.config;
  return {
    kind: 'beanstalk-v2',
    prelandMode: config.preland_mode,
    prelandLatency: prelandSeconds(config),
    settings: {
      recheck: config.recheck,
      recheckFallback: config.recheck_fallback,
      window: config.window,
      releaseOnCheck: releasesOnCheck(config),
      flakeConfirm: config.flake_confirm,
      inheritedReds: config.inherited_reds,
      earlyTickets: config.early_tickets,
      reconcile: config.reconcile,
      escalateAfter: config.escalate_after,
      reconcileParties: config.reconcile_parties,
      testsFirst: config.tests_first,
      targetedLandingCheck: config.targeted_landing_check,
      decisionOutcome: config.decision_outcome,
      decisionMode: config.decision_mode,
      singleSuspectRevert: config.single_suspect_revert,
      validationFirst: config.validation_first,
      baseCulprits: config.base_culprits,
      startCards: config.start_cards,
      rescue: config.rescue,
      dynamicCulprits: config.dynamic_culprits,
      startOrder: config.start_order,
      windowSizes: {
        start: config.window_start,
        growth: config.window_growth,
        max: config.window_max,
        min: config.window_min,
      },
      structuralMerge: usesStructuralMerge(config),
      liveSync: config.live_sync,
      ...(config.live_sync_midrun ? { liveSyncMidrun: true } : {}),
      maxBeanInvocations: config.max_bean_invocations,
      tailGuardMinutes: config.tail_guard_minutes,
      ...(config.park ? { park: true } : {}),
    },
    sprout: base,
    green: base,
    greenIdx: -1,
    commits: [],
    shaIdx: { [base]: -1 },
    validating: [],
    validated: {},
    confirming: {},
    redValidations: {},
    sightings: {},
    window: { size: config.window_start, waiting: [] },
    recheckMeter: { mode: 'checking', greenStreak: 0, skips: 0 },
    flakes: {},
    tickets: {},
    ticketSeq: 0,
    bisects: {},
    reverts: {},
    unstarted: [...ctx.state.order],
    authoring: {},
    readSets: {},
    landings: {},
    agentQueue: [],
    agentWaitSince: {},
    recentChecks: [],
    pairReds: {},
    decidedPairs: {},
    reconciledPairs: {},
    pairRepeats: {},
    cards: {},
    cardSeq: 0,
    authors: {},
    carried: {},
    rescued: {},
    turn: { holder: null, queue: [] },
    stalk: { pushed: base, target: base, inFlight: null },
    waits: {},
    stuckLogged: false,
    stats: initialStats(),
  };
}

function initialStats(): V2State['stats'] {
  return {
    placements_disjoint: 0,
    placements_overlap: 0,
    placement_overlap_modules: 0,
    landings: 0,
    fixer_landings: 0,
    reverts: 0,
    validations: 0,
    validations_green: 0,
    validations_red: 0,
    stale_reds: 0,
    tickets: 0,
    tickets_closed: 0,
    tickets_escalated: 0,
    tickets_by_method: {},
    suspects_per_ticket: [],
    trunk_bisect_runs: 0,
    pauses: 0,
    paused_seconds: 0,
    fixers_without_change: 0,
    preland_checks: 0,
    preland_red: 0,
    preland_seconds: 0,
    preland_reworks: 0,
    preland_drops: 0,
    preland_optimistic_landings: 0,
    preland_rechecks: 0,
    preland_locked_fallbacks: 0,
    preland_skipped_rechecks: 0,
    preland_hunk_disjoint: 0,
    preland_hunk_overlap: 0,
    informed_reworks: 0,
    cards: 0,
    card_details: [],
    revert_first: 0,
    agent_waits: 0,
    agent_wait_seconds: 0,
    validation_reruns: 0,
    flakes_suspected: 0,
    amendments: 0,
    amendments_none: 0,
    amendments_rejected: 0,
    amendments_rolled_back: 0,
    reexecutions: 0,
    adoptions_in_place: 0,
    inherited_reds: 0,
    window_waits: 0,
    recheck_samples: 0,
    early_tickets: 0,
    confirmed_by_sighting: 0,
    reconciles: 0,
    reconciled: 0,
    contradictions: 0,
    stale_rechecks: 0,
    stuck_drops: 0,
    start_cards: 0,
    rescues: 0,
    dynamic_culprit_runs: 0,
    dynamic_culprit_probes: 0,
    tests_first_accepted: 0,
    tests_first_fallbacks: 0,
    targeted_checks: 0,
    targeted_red: 0,
    syncs_applied: 0,
    syncs_noted: 0,
  };
}

/** Hooks for one step: the modules' continuations are bound here, so they never import each other in a cycle. */
function v2Hooks(ctx: StepContext, state: V2State): PolicyHooks {
  const step: V2Step = {
    ctx,
    state,
    flow: {
      granted: (holder) => onGranted(step, holder),
      attempt: (task) => attempt(step, task),
      startWork: (flow, slot) => startWork(step, flow, slot),
    },
  };
  return {
    dispatch: () => dispatch(step),
    onInitialCommitted: (task) => startLanding(step, task),
    onReworkResult: (outcome: ReworkOutcome) => {
      if (outcome.kind === 'test-author') onAuthorDone(step, outcome);
      else if (outcome.kind === 'test-first') onTestsFirstDone(step, outcome);
      else if (outcome.kind === 'reconcile') onReconcileDone(step, outcome);
      else if (outcome.kind === 'sync') onSyncDone(step, outcome);
      else onReworkDone(step, outcome);
    },
    onJobDone: (jobId: JobId, result: JobResult) => routeJob(step, jobId, result),
    midrunOffer: (inv, files) => midrunOffer(step, inv, files),
    onMidrunSyncs: (inv, body) => onMidrunSyncs(step, inv, body),
    onJobFailed: (jobId: JobId, error: string) => onJobFailed(step, { jobId, error }),
    onCiDone: (ciId: CiId, result: CheckResult) => routeCi(step, ciId, result),
    onTimer: (key: string) => routeTimer(step, key),
    onDecision: (answer) => answerCard(step, answer),
    isFinished: () => isFinished(step),
    finalGreenSha: () => state.green,
    rerunsRedFinalSuite: () => state.settings.flakeConfirm && state.greenIdx >= 0,
  };
}

/**
 * `dispatch`: beans that waited out an inherited red check again once the sprout moved;
 * beans waiting for an agent go first (an agent finishes a bean before it starts
 * another), then free slots take unstarted beans in priority order from the sprout head
 * (`place` is FIFO, or dependency-aware with `start_order: dependency`, `v2-start-order`; the
 * error-budget controller is not built). Then the validator.
 */
function dispatch(step: V2Step): void {
  const { ctx, state } = step;
  wakeInherited(step);
  admitWaiting(step);
  assignAgents(step);
  while (state.unstarted.length > 0) {
    const slot = freeAskingSlot(ctx);
    if (slot === undefined) break;
    const choice = chooseStart(ctx, state.unstarted, state.settings.startOrder ?? 'fifo');
    if (choice === null) break;
    const id = choice.task;
    state.unstarted = state.unstarted.filter((other) => other !== id);
    const task = requireTask(ctx, id);
    countPlacement(state, choice.overlap.length);
    emit(ctx, 'placement.decision', {
      task: id,
      rule: choice.rule,
      predicted: [...task.selected],
      overlap: [...choice.overlap],
      occupied: { ...choice.occupied },
      skipped: [...choice.skipped],
    });
    task.status = 'running';
    hold(ctx, slot, id);
    if (openStartCard(step, slot, id)) continue;
    if (state.settings.testsFirst) startTestsFirst(step, slot, id);
    else startTask(ctx, slot, id, state.sprout);
  }
  maybeValidate(step);
}

function countPlacement(state: V2State, overlapModules: number): void {
  if (overlapModules === 0) state.stats.placements_disjoint += 1;
  else state.stats.placements_overlap += 1;
  state.stats.placement_overlap_modules += overlapModules;
}

/** A slot was found for a bean's awaited work. */
function startWork(step: V2Step, flow: LandingFlow, slot: SlotId): void {
  const current = flow.step;
  if (current.kind !== 'awaiting-agent') {
    throw new EngineInvariantError(`${flow.task} is not waiting for an agent`);
  }
  const work = current.work;
  switch (work.kind) {
    case 'conflict':
      startConflictRework(step, flow, slot, work);
      return;
    case 'informed':
      startInformedRework(step, flow, slot, work);
      return;
    case 'reconcile':
      startReconcile(step, flow, slot, work);
      return;
    case 'author':
      startAuthor(step, flow, slot, work.card);
      return;
    case 'reexec':
      startReexecution(step, flow, slot, work.card);
      return;
    case 'adopt':
      startAdoptRework(step, flow, slot, work.card);
      return;
    case 'start':
      startUnderCard(step, flow, slot, work.card);
      return;
    case 'rescue':
      startRescue(step, flow, slot, work);
      return;
    default:
      assertNever(work);
  }
}

function onGranted(step: V2Step, holder: TurnHolder): void {
  switch (holder.kind) {
    case 'landing':
      onLandingTurn(step, holder.task);
      return;
    case 'revert':
      onRevertTurn(step, holder.ticket);
      return;
    default:
      assertNever(holder);
  }
}

function routeJob(step: V2Step, jobId: JobId, result: JobResult): void {
  const wait = takeWait(step.state, jobId);
  if (wait === undefined) return;
  switch (wait.kind) {
    case 'landing':
      onLandingJob(step, wait.task, jobId, result);
      return;
    case 'diff':
      onCulpritDiff(step, wait, result);
      return;
    case 'loo-revert':
      onLeaveOneOutBuilt(step, wait, result);
      return;
    case 'ticket-revert':
      onTicketRevertJob(step, wait.ticket, jobId, result);
      return;
    case 'card':
      onCardJob(step, wait.card, jobId, result);
      return;
    case 'tests-first':
      onTestsFirstJob(step, wait.task, jobId, result);
      return;
    case 'stalk':
      onStalkJob(step, jobId, result);
      return;
    case 'validate':
    case 'confirm':
    case 'probe':
    case 'loo-check':
      throw new EngineInvariantError(`CI wait ${wait.kind} got a job result`);
    default:
      assertNever(wait);
  }
}

/**
 * A runner job failed for good. One bean's work drops only that bean, a culprit's diff
 * becomes a note, a card goes on without what the job would give; work on the shared lines
 * (sprout, stalk, tickets) aborts.
 */
function onJobFailed(step: V2Step, failure: { jobId: JobId; error: string }): boolean {
  const wait = step.state.waits[failure.jobId];
  if (wait?.kind === 'landing') {
    takeWait(step.state, failure.jobId);
    return onLandingJobFailed(step, wait.task, failure);
  }
  if (wait?.kind === 'diff') {
    takeWait(step.state, failure.jobId);
    onCulpritDiffFailed(step, wait);
    return true;
  }
  if (wait?.kind === 'card') {
    takeWait(step.state, failure.jobId);
    onCardJobFailed(step, wait.card, failure.error);
    return true;
  }
  if (wait?.kind === 'tests-first') {
    takeWait(step.state, failure.jobId);
    onTestsFirstJobFailed(step, wait.task, failure.error);
    return true;
  }
  return false;
}

function routeCi(step: V2Step, ciId: CiId, result: CheckResult): void {
  const wait: V2Wait | undefined = takeWait(step.state, ciId);
  if (wait === undefined) return;
  switch (wait.kind) {
    case 'validate':
      onValidated(step, wait.idx, result);
      return;
    case 'confirm':
      onConfirmed(step, wait.idx, result);
      return;
    case 'probe':
      onProbe(step, wait.ticket, ciId, result);
      return;
    case 'loo-check':
      onLeaveOneOutChecked(step, wait, result);
      return;
    case 'landing':
    case 'diff':
    case 'loo-revert':
    case 'ticket-revert':
    case 'card':
    case 'tests-first':
    case 'stalk':
      throw new EngineInvariantError(`job wait ${wait.kind} got a CI result`);
    default:
      assertNever(wait);
  }
}

function routeTimer(step: V2Step, key: string): void {
  const timer = parseTimerKey(key);
  if (timer === null) return;
  switch (timer.kind) {
    case 'latency':
      onLatencyElapsed(step, timer.task);
      return;
    case 'fail-first':
      onFailFirstElapsed(step, timer.task);
      return;
    case 'tests-first':
      onTestsFirstElapsed(step, timer.task);
      return;
    case 'oracle':
      onOracle(step, timer.card);
      return;
    default:
      assertNever(timer);
  }
}

/**
 * `finished`: every bean is green or dropped, nothing is open or running, and the stalk
 * caught up with the sprout. A red head that nothing can repair stops the race
 * (`race.stuck`), as an escalated revert conflict does in the harness.
 */
function isFinished(step: V2Step): boolean {
  const { ctx, state } = step;
  const tasks = Object.values(ctx.state.tasks);
  const isQuiet =
    activeTickets(state).length === 0 &&
    !tasks.some((task) => task.status === 'running' || task.status === 'rework') &&
    state.validating.length === 0 &&
    Object.keys(state.reverts).length === 0 &&
    Object.keys(state.bisects).length === 0 &&
    !hasPendingCards(step) &&
    isTurnIdle(state) &&
    isStalkSettled(state);
  const headIdx = state.commits.length - 1;
  const isRedHead = state.greenIdx < headIdx && state.validated[headIdx] === false;
  if (isQuiet && state.unstarted.length === 0 && isRedHead) {
    if (!state.stuckLogged) {
      state.stuckLogged = true;
      emit(ctx, 'race.stuck', { trunk_idx: headIdx, green_idx: state.greenIdx });
    }
    return true;
  }
  return tasks.every(isTerminal) && isQuiet && state.greenIdx === headIdx;
}

/** The v2.0 rules exactly (the harness's v2), for the variant label. */
function isV20(settings: V2Settings): boolean {
  return (
    settings.recheck === 'file' &&
    settings.window === 'off' &&
    !settings.releaseOnCheck &&
    !settings.flakeConfirm &&
    settings.inheritedReds === 'off' &&
    !settings.earlyTickets &&
    !settings.reconcile &&
    settings.decisionOutcome === 'decline' &&
    !hasV25Rule(settings) &&
    variantAdditions(settings).length === 0
  );
}

/** The window sizes v2.3 and v2.4 ran with (start 4, +2 per green, at most 16, at least 2). */
const V24_WINDOW = { start: 4, growth: 2, max: 16, min: 2 } as const;

/**
 * Whether any v2.5 rule is on: A's escalation and parties, B's lone-suspect reverts, base
 * culprits, validations first and window sizes, C's structural merge tier, E's start cards,
 * rescue and dynamic culprits, and the tail fix's bounds. `V25_RULES_OFF` turns every one off.
 */
function hasV25Rule(settings: V2Settings): boolean {
  const { windowSizes: sizes } = settings;
  const isV25Window =
    settings.window === 'aimd' &&
    (sizes.start !== V24_WINDOW.start ||
      sizes.growth !== V24_WINDOW.growth ||
      sizes.max !== V24_WINDOW.max ||
      sizes.min !== V24_WINDOW.min);
  return (
    settings.escalateAfter < 2 ||
    (settings.reconcile && settings.reconcileParties > 1) ||
    settings.singleSuspectRevert ||
    settings.validationFirst ||
    settings.baseCulprits ||
    isV25Window ||
    settings.structuralMerge ||
    settings.startCards ||
    settings.rescue ||
    settings.dynamicCulprits ||
    hasTailBounds(settings) ||
    settings.park === true
  );
}

/** v2.5's tail fix: a ceiling on a bean's invocations, or the tail guard. */
function hasTailBounds(settings: V2Settings): boolean {
  return (settings.maxBeanInvocations ?? 0) > 0 || (settings.tailGuardMinutes ?? 0) > 0;
}

/**
 * Opt-in tracks reported next to the variant, never as a variant of their own: forge-owned
 * tests (`tests_first`, `targeted_landing_check`) and dependency-aware starts.
 */
function variantAdditions(settings: V2Settings): string[] {
  return [
    ...(settings.testsFirst ? ['tests_first'] : []),
    ...(settings.targetedLandingCheck ? ['targeted_landing_check'] : []),
    ...((settings.startOrder ?? 'fifo') === 'dependency' ? ['start_order:dependency'] : []),
    ...((settings.liveSync ?? 'off') === 'off' ? [] : [`live_sync:${settings.liveSync}`]),
    ...(settings.liveSyncMidrun === true ? ['live_sync_midrun'] : []),
  ];
}

/**
 * `v2` (the harness's rules), `v2.5` when a v2.5 rule is on, `v2.4` when reconciling, `v2.3`
 * when a v2.3 rule is on, else `v2.2`. The opt-in tracks never change it (`variantAdditions`).
 */
function variantOf(settings: V2Settings): Variant {
  if (isV20(settings)) return 'v2';
  if (hasV25Rule(settings)) return 'v2.5';
  if (settings.reconcile) return 'v2.4';
  const isV23 =
    settings.window === 'aimd' ||
    settings.recheck === 'sampled' ||
    settings.inheritedReds === 'readset' ||
    settings.earlyTickets;
  return isV23 ? 'v2.3' : 'v2.2';
}

type Variant = 'v2' | 'v2.2' | 'v2.3' | 'v2.4' | 'v2.5';

const VARIANT_ROWS: Readonly<Record<Variant, string>> = {
  v2: V20_VARIANT_ROW,
  'v2.2': V22_VARIANT_ROW,
  'v2.3': V23_VARIANT_ROW,
  'v2.4': V24_VARIANT_ROW,
  'v2.5': V25_VARIANT_ROW,
};

/** `policy_summary` of v2 (the beanstalk block, in the harness's key and row order, then v2.2's). */
function v2Summary(state: V2State, nowSeconds: number): PolicySummary {
  const { stats, settings } = state;
  const suspects = stats.suspects_per_ticket;
  const prelandSecondsTotal = roundTo(stats.preland_seconds, 2);
  const pausedSeconds = roundTo(stats.paused_seconds, 2);
  const block: Record<string, Json> = {
    placements_disjoint: stats.placements_disjoint,
    placements_overlap: stats.placements_overlap,
    placement_overlap_modules: stats.placement_overlap_modules,
    landings: stats.landings,
    fixer_landings: stats.fixer_landings,
    reverts: stats.reverts,
    validations: stats.validations,
    validations_green: stats.validations_green,
    validations_red: stats.validations_red,
    stale_reds: stats.stale_reds,
    tickets: stats.tickets,
    tickets_closed: stats.tickets_closed,
    tickets_escalated: stats.tickets_escalated,
    tickets_by_method: { ...stats.tickets_by_method },
    trunk_bisect_runs: stats.trunk_bisect_runs,
    pauses: stats.pauses,
    paused_seconds: pausedSeconds,
    fixers_without_change: stats.fixers_without_change,
    preland_checks: stats.preland_checks,
    preland_red: stats.preland_red,
    preland_seconds: prelandSecondsTotal,
    preland_reworks: stats.preland_reworks,
    preland_drops: stats.preland_drops,
    preland_mode: state.prelandMode,
    preland_latency: state.prelandLatency,
    preland_optimistic_landings: stats.preland_optimistic_landings,
    preland_rechecks: stats.preland_rechecks,
    preland_locked_fallbacks: stats.preland_locked_fallbacks,
    preland_recheck_rule: settings.recheck,
    preland_skipped_rechecks: stats.preland_skipped_rechecks,
    preland_hunk_disjoint: stats.preland_hunk_disjoint,
    preland_hunk_overlap: stats.preland_hunk_overlap,
    informed_reworks: stats.informed_reworks,
    cards: stats.cards,
    card_details: stats.card_details.map((detail) => ({
      ...detail,
      against: [...detail.against],
      specs: { ...detail.specs },
    })),
    revert_first: stats.revert_first,
    release_on_check: settings.releaseOnCheck,
    agent_waits: stats.agent_waits,
    agent_wait_seconds: roundTo(stats.agent_wait_seconds, 2),
    flake_confirm: settings.flakeConfirm,
    validation_reruns: stats.validation_reruns,
    flakes_suspected: stats.flakes_suspected,
    flaky_tests: { ...state.flakes },
    inherited_reds: settings.inheritedReds,
    inherited_red_waits: stats.inherited_reds,
    window: settings.window,
    window_size: settings.window === 'aimd' ? state.window.size : null,
    window_waits: stats.window_waits,
    recheck_samples: stats.recheck_samples,
    early_tickets: settings.earlyTickets,
    early_tickets_opened: stats.early_tickets,
    confirmed_by_sighting: stats.confirmed_by_sighting,
    reconcile: settings.reconcile,
    reconciles: stats.reconciles,
    reconciled: stats.reconciled,
    contradictions: stats.contradictions,
    stale_rechecks: stats.stale_rechecks,
    escalate_after: settings.escalateAfter,
    reconcile_parties: settings.reconcileParties,
    stuck_drops: stats.stuck_drops,
    start_cards: settings.startCards,
    start_cards_raised: stats.start_cards,
    rescue: settings.rescue,
    rescues: stats.rescues,
    dynamic_culprits: settings.dynamicCulprits,
    dynamic_culprit_runs: stats.dynamic_culprit_runs,
    dynamic_culprit_probes: stats.dynamic_culprit_probes,
    ...(settings.dynamicCulprits
      ? { dynamic_culprit_skips: stats.dynamic_culprit_skips ?? 0 }
      : {}),
    ...(hasTailBounds(settings)
      ? {
          max_bean_invocations: settings.maxBeanInvocations ?? 0,
          tail_guard_minutes: settings.tailGuardMinutes ?? 0,
          invocation_drops: stats.invocation_drops ?? 0,
          tail_drops: stats.tail_drops ?? 0,
        }
      : {}),
    ...(settings.park === true ? { park: true } : {}),
    tests_first: settings.testsFirst,
    tests_first_accepted: stats.tests_first_accepted,
    tests_first_fallbacks: stats.tests_first_fallbacks,
    targeted_landing_check: settings.targetedLandingCheck,
    targeted_checks: stats.targeted_checks,
    targeted_red: stats.targeted_red,
    decision_outcome: settings.decisionOutcome,
    decision_mode: settings.decisionMode,
    amendments: stats.amendments,
    amendments_none: stats.amendments_none,
    amendments_rejected: stats.amendments_rejected,
    amendments_rolled_back: stats.amendments_rolled_back,
    reexecutions: stats.reexecutions,
    adoptions_in_place: stats.adoptions_in_place,
    mean_suspects_per_ticket:
      suspects.length > 0
        ? roundTo(suspects.reduce((sum, count) => sum + count, 0) / suspects.length, 3)
        : null,
    final_trunk_idx: state.commits.length - 1,
    final_green_idx: state.greenIdx,
    open_tickets_at_end: activeTickets(state).length,
    ticket_details: ticketDetails(state, nowSeconds),
    variant: variantOf(settings),
    variant_additions: variantAdditions(settings),
    // Reported only off the default, so FIFO summaries stay byte-identical with the harness's.
    ...(settings.startOrder === 'dependency' ? { start_order: settings.startOrder } : {}),
    ...((settings.liveSync ?? 'off') === 'off'
      ? {}
      : {
          live_sync: settings.liveSync ?? 'off',
          syncs_applied: stats.syncs_applied,
          syncs_noted: stats.syncs_noted,
        }),
    ...(settings.liveSyncMidrun === true
      ? {
          live_sync_midrun: true,
          midrun_offered: stats.midrun_offered ?? 0,
          midrun_applied: stats.midrun_applied ?? 0,
          midrun_noted: stats.midrun_noted ?? 0,
        }
      : {}),
  };
  return {
    key: 'beanstalk',
    stats: block,
    rows: summaryRows(state, { prelandSecondsTotal, pausedSeconds }),
  };
}

/** The variant's row, with its opt-in tracks after a `+` each. */
function variantRow(settings: V2Settings): string {
  const additions = variantAdditions(settings).map((addition) => ADDITION_ROWS[addition]);
  return [VARIANT_ROWS[variantOf(settings)], ...additions].join(' + ');
}

function ticketDetails(state: V2State, nowSeconds: number): Json[] {
  const label = (idx: number): string => {
    const commit = state.commits[idx];
    return commit?.task ?? commit?.kind ?? '?';
  };
  return Object.values(state.tickets).map((ticket) => ({
    id: ticket.id,
    method: ticket.method,
    status: ticket.status,
    attempts: ticket.attempt,
    failing: [...ticket.failingFiles],
    suspects: ticket.suspects.map(label),
    concurrent: ticket.concurrent.map(label),
    open_seconds: roundTo((ticket.closedAt ?? nowSeconds) - ticket.openedAt, 2),
  }));
}

function summaryRows(
  state: V2State,
  rounded: { prelandSecondsTotal: number; pausedSeconds: number },
): (readonly [string, Json])[] {
  const { stats, settings } = state;
  return [
    ['Variant', variantRow(settings)],
    [
      'Informed reworks / decision cards / revert-first tickets',
      `${stats.informed_reworks} / ${stats.cards} / ${stats.revert_first}`,
    ],
    [
      'Agent released on check / reworks that waited for an agent / wait minutes',
      `${settings.releaseOnCheck ? 'yes' : 'no'} / ${stats.agent_waits} / ` +
        pythonFloat(roundTo(stats.agent_wait_seconds / 60, 2)),
    ],
    [
      'Validation re-runs / suspected flakes',
      `${stats.validation_reruns} / ${stats.flakes_suspected}`,
    ],
    [
      'Inherited reds waited out (no rework round spent)',
      settings.inheritedReds === 'off' ? 'off' : String(stats.inherited_reds),
    ],
    [
      'Reconciles (reconciled / contradictions) / stale re-checks',
      settings.reconcile
        ? `${stats.reconciles} (${stats.reconciled} / ${stats.contradictions}) / ${stats.stale_rechecks}`
        : 'off',
    ],
    [
      'Escalate after (failed repairs) / reconcile parties / dropped stuck after a card',
      `${settings.escalateAfter} / ${settings.reconcileParties} / ${stats.stuck_drops}`,
    ],
    [
      'Start cards / rescues / dynamic culprit searches (probes)',
      `${settings.startCards ? stats.start_cards : 'off'} / ${settings.rescue ? stats.rescues : 'off'} / ` +
        (settings.dynamicCulprits
          ? `${stats.dynamic_culprit_runs} (${stats.dynamic_culprit_probes})`
          : 'off'),
    ],
    ...tailBoundsRows(settings, stats),
    [
      'Tests first (accepted / fallbacks) / targeted landing checks (red)',
      `${settings.testsFirst ? `${stats.tests_first_accepted} / ${stats.tests_first_fallbacks}` : 'off'} / ` +
        (settings.targetedLandingCheck
          ? `${stats.targeted_checks} (${stats.targeted_red})`
          : 'off'),
    ],
    [
      'Sprout window at the end / window waits / early tickets / re-check samples',
      `${settings.window === 'aimd' ? state.window.size : 'off'} / ${stats.window_waits} / ` +
        `${stats.early_tickets} / ${stats.recheck_samples}`,
    ],
    [
      'Spec amendments (amended / none / rejected / rolled back) / re-executions / adopted in place',
      `${stats.amendments} / ${stats.amendments_none} / ${stats.amendments_rejected} / ` +
        `${stats.amendments_rolled_back} / ${stats.reexecutions} / ${stats.adoptions_in_place}`,
    ],
    [
      'Pre-land checks (red) / reworks / drops',
      `${stats.preland_checks} (${stats.preland_red}) / ${stats.preland_reworks} / ${stats.preland_drops}`,
    ],
    ['Pre-land check minutes', pythonFloat(roundTo(rounded.prelandSecondsTotal / 60, 2))],
    [
      'Re-check rule / skipped (adaptive) / hunk-disjoint / hunk-overlap',
      `${settings.recheck} / ${stats.preland_skipped_rechecks} / ${stats.preland_hunk_disjoint} / ` +
        `${stats.preland_hunk_overlap}`,
    ],
    [
      'Pre-land mode / latency s / optimistic landings / rechecks / locked fallbacks',
      `${state.prelandMode} / ${pythonFloat(state.prelandLatency)} / ${stats.preland_optimistic_landings}` +
        ` / ${stats.preland_rechecks} / ${stats.preland_locked_fallbacks}`,
    ],
    [
      'Placements disjoint / overlapping',
      `${stats.placements_disjoint} / ${stats.placements_overlap}`,
    ],
    [
      'Fast-trunk landings (task / fixer / revert)',
      `${stats.landings} / ${stats.fixer_landings} / ${stats.reverts}`,
    ],
    ['Validations (green / red)', `${stats.validations_green} / ${stats.validations_red}`],
    [
      'Repair tickets (closed / escalated / by method)',
      `${stats.tickets_closed} / ${stats.tickets_escalated} / ${pythonCounts(stats.tickets_by_method)}`,
    ],
    [
      'Error-budget pauses / paused minutes',
      `${stats.pauses} / ${pythonFloat(roundTo(rounded.pausedSeconds / 60, 2))}`,
    ],
  ];
}

/** v2.5's tail fix, when on: its two bounds and the beans each dropped. */
function tailBoundsRows(settings: V2Settings, stats: V2State['stats']): [string, Json][] {
  if (!hasTailBounds(settings)) return [];
  return [
    [
      'Max bean invocations / tail guard minutes / dropped by each',
      `${bound(settings.maxBeanInvocations)} / ${bound(settings.tailGuardMinutes)} / ` +
        `${stats.invocation_drops ?? 0} / ${stats.tail_drops ?? 0}`,
    ],
  ];
}

/** A tail bound as the summary row shows it: its value, or `off`. */
function bound(value: number | undefined): string {
  return value !== undefined && value > 0 ? String(value) : 'off';
}

/**
 * What the live page and the web app show (`V2PolicyView` in `@beanstalk/shared-race/rpc`):
 * the sprout and the stalk, beans in flight, the turn, tickets, cards, flakes, the rules.
 */
function v2View(state: V2State): V2PolicyView {
  const reds = state.recentChecks.filter((green) => !green).length;
  return {
    kind: 'beanstalk-v2',
    sprout: { sha: state.sprout, idx: state.commits.length - 1 },
    stalk: { sha: state.green, idx: state.greenIdx, ref: state.stalk.pushed },
    unvalidated: state.commits.length - 1 - state.greenIdx,
    validating: [...state.validating],
    turn: state.turn.holder === null ? null : turnLabel(state.turn.holder),
    waiting_for_turn: state.turn.queue.map(turnLabel),
    beans: Object.values(state.landings).map((flow) => ({
      task: flow.task,
      slot: flow.slot,
      step: flow.step.kind,
      rounds: flow.rounds,
      rechecks: flow.rechecks,
    })),
    agent_queue: [...state.agentQueue],
    tickets: Object.values(state.tickets).map((ticket) => ({
      ticket: ticket.id,
      status: ticket.status,
      method: ticket.method,
      red_idx: ticket.redIdx,
      failing: [...ticket.failingFiles],
    })),
    cards: Object.values(state.cards).map((card) => ({
      card: card.id,
      task: card.task,
      against: [...card.against],
      specs: { ...card.specs },
      status: card.status,
      winner: card.winner,
      loser: card.loser,
      outcome: card.outcome,
      text: card.text,
      opened_at: roundTo(card.openedAt, 3),
      amendment:
        card.amendment === null
          ? null
          : {
              status: card.amendment.status,
              paths: Object.keys(card.amendment.files).toSorted(),
            },
    })),
    flakes: { ...state.flakes },
    recent_checks: { count: state.recentChecks.length, reds },
    window:
      state.settings.window === 'aimd'
        ? {
            size: state.window.size,
            unvalidated: state.commits.length - 1 - state.greenIdx,
            waiting: [...state.window.waiting],
          }
        : null,
    recheck_mode: state.recheckMeter.mode,
    settings: {
      recheck: state.settings.recheck,
      recheck_fallback: state.settings.recheckFallback,
      release_on_check: state.settings.releaseOnCheck,
      flake_confirm: state.settings.flakeConfirm,
      inherited_reds: state.settings.inheritedReds,
      early_tickets: state.settings.earlyTickets,
      reconcile: state.settings.reconcile,
      decision_outcome: state.settings.decisionOutcome,
      decision_mode: state.settings.decisionMode,
    },
    stats: {
      landings: state.stats.landings,
      reverts: state.stats.reverts,
      preland_checks: state.stats.preland_checks,
      preland_red: state.stats.preland_red,
      informed_reworks: state.stats.informed_reworks,
      cards: state.stats.cards,
      validations_green: state.stats.validations_green,
      validations_red: state.stats.validations_red,
    },
  };
}

function turnLabel(holder: TurnHolder): string {
  switch (holder.kind) {
    case 'landing':
      return holder.task;
    case 'revert':
      return holder.ticket;
    default:
      return assertNever(holder);
  }
}
