/**
 * `summary.json` for a cloud run: a port of `research/race/harness/summary.py` `build()`,
 * computed from the engine state, so `report.py` compares cloud and local runs unchanged.
 */
import type { Json } from '@beanstalk/shared-race/events';
import {
  errorBudget,
  protectTestsMode,
  snapshotMode,
  usesUnionMerge,
} from '@beanstalk/shared-race/run-config';

import { placementModules, precisionRecall } from './arena';
import type { Prf } from './arena';
import type { EngineEnv } from './catalog';
import { harnessPolicyName } from './lifecycle';
import { finalCheckFields } from './final-check';
import type { InvocationRecord, InvocationStats, TaskState } from './model';
import { mean, percentile, roundTo } from './numbers';
import { summarizePolicy } from './policy';
import type { EngineState } from './state';

type JsonObject = Record<string, Json>;

const SUBSCRIPTION_NOTE =
  'claude -p on a claude.ai plan: total_cost_usd is computed at list prices (costBasis=list); ' +
  'invocations on overage are billed as extra usage';

/** Builds the summary at `nowSeconds` (the end of the race once it ended). */
export function buildSummary(state: EngineState, env: EngineEnv, nowSeconds: number): JsonObject {
  const config = env.config;
  const raceT0 = state.raceT0 ?? nowSeconds;
  const wall = (state.endedAt ?? nowSeconds) - raceT0;
  const tasks = state.order.flatMap((id) => {
    const task = state.tasks[id];
    return task === undefined ? [] : [task];
  });
  const green = tasks.filter((task) => task.status === 'green');
  const summary: JsonObject = {
    label: label(state, env, tasks.length),
    policy: harnessPolicyName(config.policy),
    agent: config.agent,
    model: modelName(env),
    arena_base: state.baseSha,
    arena_digest: config.arena_digest,
    config: configBlock(env, tasks.length),
    aborted: state.aborted,
    wall_seconds: roundTo(wall, 2),
    tasks: tasks.length,
    tasks_green: green.length,
    tasks_landed: tasks.filter((task) => task.landedSha !== null).length,
    tasks_dropped: tasks.filter((task) => task.status === 'dropped').length,
    acceptance_restored: acceptanceRestored(env, tasks),
    drops_by_reason: dropsByReason(tasks),
    changes_green_per_hour: wall > 0 ? roundTo(green.length / (wall / 3600), 3) : null,
    wall_to_all_green_seconds: wallToAllGreen(green, tasks.length, raceT0),
    task_start_to_green_seconds: startToGreen(green),
    ...agentMinutes(state),
    ...invocationBlocks(state),
    ...ciBlocks(state),
    textual_conflicts: state.conflictsMet,
    red_validations: state.redValidations,
    final: finalBlock(state),
    footprint_quality: footprintQuality(env, tasks),
    per_task: perTask(state, env, tasks, raceT0),
  };
  if (state.policy !== null) {
    const policy = summarizePolicy(state.policy, nowSeconds);
    summary[policy.key] = policy.stats;
    summary['policy_rows'] = policy.rows;
  }
  return summary;
}

/** `os.path.basename(os.path.normpath(arena))`. */
function arenaName(arena: string): string {
  const parts = arena.split('/').filter((part) => part !== '');
  return parts.at(-1) ?? arena;
}

function modelName(env: EngineEnv): string | null {
  return env.config.model ?? (env.config.agent === 'replay' ? 'replay' : null);
}

function label(state: EngineState, env: EngineEnv, taskCount: number): string {
  const config = env.config;
  const arena = arenaName(config.arena);
  const agent =
    config.agent === 'replay'
      ? ' (replay control: reference patches, synthetic timings)'
      : ` (${modelName(env) ?? ''})`;
  return (
    `measured: arena=${arena}@${(state.baseSha ?? '').slice(0, 8)}/${config.arena_digest.slice(0, 8)}, ` +
    `${taskCount} tasks, policy=${harnessPolicyName(config.policy)}, agent=${config.agent}${agent}`
  );
}

function configBlock(env: EngineEnv, taskCount: number): JsonObject {
  const config = env.config;
  const isQueue = config.policy === 'queue';
  return {
    agents: config.agents,
    ci_seconds: config.ci_seconds,
    ci_slots: config.ci_slots,
    batch: isQueue ? config.batch : null,
    seed: config.seed,
    budget_usd: config.budget_usd,
    max_turns: config.max_turns,
    agent_timeout: config.agent_timeout,
    union_merge: usesUnionMerge(config),
    snapshot: isQueue ? null : snapshotMode(config),
    queue_hold: isQueue ? config.queue_hold : null,
    error_budget: isQueue ? null : errorBudget(config),
    footprint: config.footprint,
    tasks: taskCount,
    protect_tests: protectTestsMode(config),
  };
}

function acceptanceRestored(env: EngineEnv, tasks: readonly TaskState[]): JsonObject {
  const isOwn = (task: TaskState, path: string): boolean =>
    Object.hasOwn(env.tasks.get(task.id)?.acceptance_tests ?? {}, path);
  const own = tasks.reduce(
    (sum, task) => sum + task.tamper.filter((path) => isOwn(task, path)).length,
    0,
  );
  const all = tasks.reduce((sum, task) => sum + task.tamper.length, 0);
  return { own, other_tasks: all - own };
}

/** `Counter(reason.split(":")[0].split(" after ")[0])`, keys sorted. */
function dropsByReason(tasks: readonly TaskState[]): JsonObject {
  const counts: Record<string, number> = {};
  for (const task of tasks.filter((candidate) => candidate.status === 'dropped')) {
    const reason = (task.dropReason ?? '?').split(':')[0]?.split(' after ')[0] ?? '?';
    counts[reason] = (counts[reason] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).toSorted(([a], [b]) => (a < b ? -1 : 1)));
}

function wallToAllGreen(
  green: readonly TaskState[],
  taskCount: number,
  raceT0: number,
): number | null {
  const times = green.flatMap((task) => (task.greenAt === null ? [] : [task.greenAt]));
  if (times.length === 0 || green.length !== taskCount) return null;
  return roundTo(Math.max(...times) - raceT0, 2);
}

function startToGreen(green: readonly TaskState[]): JsonObject {
  const spans = green.flatMap((task) =>
    task.greenAt === null || task.startedAt === null ? [] : [task.greenAt - task.startedAt],
  );
  return {
    median: percentile(spans, 0.5),
    p90: percentile(spans, 0.9),
    mean: spans.length > 0 ? roundTo(mean(spans), 2) : null,
  };
}

const minutes = (value: number): number => roundTo(value / 60, 2);

function agentMinutes(state: EngineState): JsonObject {
  const totals = { busy: 0, blocked: 0, idle: 0 };
  for (const slot of state.slots) {
    totals.busy += slot.totals.busy;
    totals.blocked += slot.totals.blocked;
    totals.idle += slot.totals.idle;
  }
  return {
    agent_minutes: {
      busy: minutes(totals.busy),
      blocked: minutes(totals.blocked),
      idle: minutes(totals.idle),
    },
    agent_minutes_per_agent: Object.fromEntries(
      state.slots.map((slot) => [
        slot.id,
        {
          busy: minutes(slot.totals.busy),
          blocked: minutes(slot.totals.blocked),
          idle: minutes(slot.totals.idle),
        },
      ]),
    ),
  };
}

/** `inv_stats` with floats rounded to 4 places, as summary.py writes them. */
function roundedStats(value: InvocationStats): JsonObject {
  return { ...value, cost_usd: roundTo(value.cost_usd, 4), wall_s: roundTo(value.wall_s, 4) };
}

function invocationBlocks(state: EngineState): JsonObject {
  const kinds = Object.keys(state.invStats).toSorted();
  const stats = (kind: string): InvocationStats | undefined => state.invStats[kind];
  const byKind = (pick: (value: InvocationStats) => Json): JsonObject =>
    Object.fromEntries(
      kinds.flatMap((kind) => {
        const value = stats(kind);
        return value === undefined ? [] : [[kind, pick(value)]];
      }),
    );
  return {
    invocations: byKind((value) => value.count),
    invocation_stats: byKind(roundedStats),
    cost_usd: roundTo(state.spent, 4),
    cost_by_kind: byKind((value) => roundTo(value.cost_usd, 4)),
    tokens_by_kind: byKind((value) => ({
      input_tokens: value.input_tokens,
      output_tokens: value.output_tokens,
      cache_read_input_tokens: value.cache_read_input_tokens,
      cache_creation_input_tokens: value.cache_creation_input_tokens,
    })),
    invocation_overhead: overhead(state.invRecords),
    subscription: subscription(state.invRecords),
  };
}

function overhead(records: readonly InvocationRecord[]): JsonObject {
  const startups = records.flatMap((record) => (record.startupMs ? [record.startupMs] : []));
  const agentRecords = records.filter((record) =>
    ['initial', 'rework', 'fixer'].includes(record.kind),
  );
  const apiGaps = agentRecords.flatMap((record) =>
    record.durationApiMs ? [record.wallMs - record.durationApiMs] : [],
  );
  return {
    startup_ms_median: percentile(startups, 0.5),
    wall_minus_api_ms_median: percentile(apiGaps, 0.5),
    cost_per_agent_invocation_mean:
      agentRecords.length > 0
        ? roundTo(mean(agentRecords.map((record) => record.costUsd)), 4)
        : null,
  };
}

function subscription(records: readonly InvocationRecord[]): JsonObject {
  const lastLimited = records.toReversed().find((record) => record.rateLimit !== null);
  return {
    invocations_on_overage: records.filter((record) => record.overage).length,
    last_rate_limit: lastLimited?.rateLimit ?? null,
    note: SUBSCRIPTION_NOTE,
  };
}

function ciBlocks(state: EngineState): JsonObject {
  const runs: Record<string, number> = {};
  const minutesByPurpose: Record<string, number> = {};
  for (const entry of state.ci.log) {
    if (entry.purpose === 'final') continue;
    const key = entry.cancelled ? `${entry.purpose}-cancelled` : entry.purpose;
    runs[key] = (runs[key] ?? 0) + 1;
    minutesByPurpose[key] = (minutesByPurpose[key] ?? 0) + entry.seconds / 60;
  }
  const roundedMinutes = Object.fromEntries(
    Object.entries(minutesByPurpose).map(([key, value]) => [key, roundTo(value, 2)]),
  );
  return {
    ci_runs: runs,
    ci_runs_total: Object.values(runs).reduce((sum, count) => sum + count, 0),
    ci_minutes: roundedMinutes,
    ci_minutes_total: roundTo(
      Object.values(roundedMinutes).reduce((sum, value) => sum + value, 0),
      2,
    ),
  };
}

function finalBlock(state: EngineState): Json {
  if (state.final?.phase !== 'done') return {};
  return finalCheckFields(state.final.report);
}

function footprintQuality(env: EngineEnv, tasks: readonly TaskState[]): JsonObject {
  const vsActual: Prf[] = [];
  const vsOracle: Prf[] = [];
  for (const task of tasks.filter((candidate) => candidate.landedSha !== null)) {
    const definition = env.tasks.get(task.id);
    const predicted = new Set(task.selected);
    vsActual.push(precisionRecall(predicted, new Set(task.actualModules)));
    if (definition === undefined) continue;
    const oraclePaths = definition.oracle_paths.filter(
      (path) => !Object.hasOwn(definition.acceptance_tests, path),
    );
    const oracle =
      definition.oracle_paths.length > 0
        ? placementModules(oraclePaths)
        : new Set(definition.oracle_modules);
    if (oracle.size > 0) vsOracle.push(precisionRecall(predicted, oracle));
  }
  return {
    method: env.config.footprint,
    threshold: env.config.footprint_threshold,
    vs_actual: averagePrf(vsActual),
    vs_oracle: averagePrf(vsOracle),
  };
}

function averagePrf(rows: readonly Prf[]): JsonObject {
  if (rows.length === 0) return {};
  const total = (key: 'tp' | 'actual' | 'pred'): number =>
    rows.reduce((sum, row) => sum + row[key], 0);
  return {
    precision: roundTo(mean(rows.map((row) => row.precision)), 4),
    recall: roundTo(mean(rows.map((row) => row.recall)), 4),
    f1: roundTo(mean(rows.map((row) => row.f1)), 4),
    tasks: rows.length,
    micro_recall: roundTo(total('tp') / Math.max(total('actual'), 1), 4),
    micro_precision: roundTo(total('tp') / Math.max(total('pred'), 1), 4),
  };
}

function perTask(
  state: EngineState,
  env: EngineEnv,
  tasks: readonly TaskState[],
  raceT0: number,
): JsonObject {
  const relative = (value: number | null): number | null =>
    value === null ? null : roundTo(value - raceT0, 3);
  const report = state.final?.phase === 'done' ? state.final.report : null;
  const perTaskReport = report !== null && !('error' in report) ? report.per_task : {};
  return Object.fromEntries(
    tasks.map((task) => [
      task.id,
      {
        status: task.status,
        agent: task.agent,
        started_at: relative(task.startedAt),
        landed_at: relative(task.landedAt),
        green_at: relative(task.greenAt),
        reworks: task.reworks,
        conflicts: task.conflicts,
        reds: task.reds,
        predicted: [...task.selected],
        actual_modules: [...task.actualModules],
        oracle_modules: [...(env.tasks.get(task.id)?.oracle_modules ?? [])],
        invocations: task.invocations.length,
        drop_reason: task.dropReason,
        tamper: [...task.tamper],
        final_acceptance: perTaskReport[task.id]?.acceptance_pass ?? null,
      },
    ]),
  );
}
