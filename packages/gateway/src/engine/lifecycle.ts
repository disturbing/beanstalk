import type { Sha } from '@beanstalk/shared-race/ids';
import { slotIds } from '@beanstalk/shared-race/ids';
import {
  errorBudget,
  protectTestsMode,
  snapshotMode,
  usesUnionMerge,
} from '@beanstalk/shared-race/run-config';

import type { EngineEnv } from './catalog';
import { taskOrder } from './catalog';
import { cancelAllCi, initialCiState } from './ci';
import type { StepContext } from './context';
import { emit, setTimer } from './context';
import { startFinalCheck } from './final-check';
import { killOpenInvocations } from './invocations';
import type { RunLabels } from './model';
import { roundTo } from './numbers';
import { bindPolicy, createPolicyState } from './policy';
import { closeSlotClocks } from './slots';
import type { EngineState } from './state';
import { newTaskState } from './tasks';

/** Probabilities listed per task in `footprint.predicted` (`list(predicted.items())[:8]`). */
const FOOTPRINT_PROBS_LISTED = 8;

/** The engine state of a freshly created run: every task pending, every slot idle. */
export function initialEngineState(env: EngineEnv, createdAtMs: number): EngineState {
  const config = env.config;
  const order = taskOrder(config);
  return {
    version: 1,
    phase: 'created',
    createdAtMs,
    clock: 0,
    paused: false,
    seq: 0,
    counters: { inv: 0, job: 0, timer: 0 },
    startedAt: null,
    raceT0: null,
    endedAt: null,
    baseSha: null,
    tasks: Object.fromEntries(
      order.map((id) => [id, newTaskState(id, config.footprints[id]?.selected ?? [])]),
    ),
    order,
    slots: slotIds(config.agents).map((id) => ({
      id,
      state: 'idle',
      since: 0,
      totals: { busy: 0, blocked: 0, idle: 0 },
      holding: null,
      running: null,
      outbox: null,
      pollId: null,
    })),
    invocations: {},
    invRecords: [],
    invStats: {},
    spent: 0,
    inflightCost: {},
    aborted: null,
    killedInvocations: 0,
    conflictsMet: 0,
    redValidations: 0,
    jobs: {},
    timers: {},
    ci: initialCiState(config.ci_slots),
    amendedTests: {},
    final: null,
    policy: null,
  };
}

/**
 * Starts the race from the base commit the admin seeded the sprout and the stalk with
 * (`Race.run` up to the main loop): logs the setup and the footprints the driver predicted
 * at intake, then `race.start`.
 */
export function startRace(ctx: StepContext, baseSha: Sha, labels: RunLabels): void {
  const state = ctx.state;
  const config = ctx.env.config;
  state.phase = 'running';
  state.baseSha = baseSha;
  state.startedAt = ctx.now;
  emit(ctx, 'race.setup', {
    policy: harnessPolicyName(config.policy),
    out: labels.out,
    repo: labels.repo,
    arena: config.arena,
    arena_digest: config.arena_digest,
    setup_seconds: roundTo(ctx.now, 3),
  });
  const setupAt = ctx.now;
  emitFootprints(ctx);
  state.raceT0 = ctx.now;
  for (const slot of state.slots) {
    slot.since = ctx.now;
    slot.totals = { busy: 0, blocked: 0, idle: 0 };
  }
  state.policy = createPolicyState(ctx);
  ctx.hooks = bindPolicy(ctx);
  emitRaceStart(ctx, baseSha, roundTo(ctx.now - setupAt, 3));
  setTimer(ctx, config.max_wall_minutes * 60, { kind: 'wall-clock' });
}

function emitFootprints(ctx: StepContext): void {
  const config = ctx.env.config;
  for (const id of ctx.state.order) {
    const footprint = config.footprints[id];
    emit(ctx, 'footprint.predicted', {
      task: id,
      method: footprint?.method ?? config.footprint,
      selected: footprint?.selected ?? [],
      probs: Object.fromEntries(
        Object.entries(footprint?.probs ?? {}).slice(0, FOOTPRINT_PROBS_LISTED),
      ),
    });
  }
}

function emitRaceStart(ctx: StepContext, baseSha: Sha, intakeSeconds: number): void {
  const config = ctx.env.config;
  emit(ctx, 'race.start', {
    policy: harnessPolicyName(config.policy),
    agent: config.agent,
    model: config.model,
    agents: config.agents,
    ci_seconds: config.ci_seconds,
    ci_slots: config.ci_slots,
    batch: config.batch,
    tasks: [...ctx.state.order],
    budget_usd: config.budget_usd,
    seed: config.seed,
    base: baseSha,
    union_merge: usesUnionMerge(config),
    snapshot: snapshotMode(config),
    queue_hold: config.queue_hold,
    protect_tests: protectTestsMode(config),
    footprint: config.footprint,
    error_budget: errorBudget(config),
    intake_seconds: intakeSeconds,
  });
}

/** The harness logs every beanstalk variant (pre-land, v2) as policy `beanstalk`. */
export function harnessPolicyName(policy: string): string {
  return policy.startsWith('beanstalk') ? 'beanstalk' : policy;
}

/**
 * `Race.shutdown`: kill what runs, cancel CI, close the slot clocks, log `race.end`, then
 * run the final check. Late job outcomes and timers of the race are dropped.
 */
export function beginShutdown(ctx: StepContext): void {
  const state = ctx.state;
  if (state.phase !== 'running') return;
  state.phase = 'finishing';
  const killed = killOpenInvocations(ctx);
  state.killedInvocations = killed;
  cancelAllCi(ctx);
  state.jobs = {};
  state.timers = {};
  for (const slot of state.slots) slot.outbox = null;
  closeSlotClocks(ctx);
  state.endedAt = ctx.now;
  emit(ctx, 'race.end', {
    aborted: state.aborted,
    killed_processes: killed,
    spent_usd: roundTo(state.spent, 4),
  });
  startFinalCheck(ctx);
}
