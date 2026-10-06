/**
 * The Cloudflare infrastructure a run uses, metered by its RunDO, and what that costs at list
 * prices. Counts are exact for what passes through the RunDO; the dollar figures are
 * estimates (see `docs/claude-opus/15-explainer-for-coop.md`, "Cost"):
 *
 * - requests: every RPC into the RunDO comes from one gateway Worker request, so it counts
 *   once as a Worker request and once as a DO request; alarms are DO requests only.
 * - DO duration: the RunDO is held active from creation to the last metered moment (long
 *   polls keep it awake), at 128 MB.
 * - Artifacts operations: every binding call, every proxied git request and one git fetch per
 *   runner call. Binding reads may turn out not to be billed (the pricing page names create,
 *   push, pull and clone), so this is an upper bound for them.
 * - Containers: `standard-2` (1 vCPU, 6 GiB, 12 GB). vCPU is billed while a call runs;
 *   memory and disk while the instance is up, which is each call plus the `sleepAfter` tail,
 *   overlapping tails counted once per instance.
 */
import { roundTo } from '../engine/numbers';
import { RUNNER_SLEEP_AFTER_SECONDS } from '../runner/runner-container';

/** List prices, Workers Paid, 2026-10 (developers.cloudflare.com, each product's pricing page). */
export const INFRA_PRICES = {
  workerRequestUsd: 0.3 / 1e6,
  doRequestUsd: 0.15 / 1e6,
  doGbSecondUsd: 12.5 / 1e6,
  artifactsOpUsd: 0.15 / 1000,
  containerVcpuSecondUsd: 0.00002,
  containerUpSecondUsd: 6 * 0.0000025 + 12 * 0.00000007,
} as const;

const DO_MEMORY_GB = 0.125;

export type InfraMeter = {
  readonly requests: number;
  readonly alarms: number;
  readonly artifactsOps: number;
  readonly runnerCalls: number;
  readonly containerBusySeconds: number;
  readonly containerUpSeconds: number;
  /** Per runner instance: when its current `sleepAfter` tail ends (ms). */
  readonly upUntilMs: Readonly<Record<string, number>>;
  readonly lastAtMs: number;
};

/** The meter as the summary reports it. */
export type InfraReport = {
  readonly worker_requests: number;
  readonly do_requests: number;
  readonly do_active_seconds: number;
  readonly artifacts_ops: number;
  readonly runner_calls: number;
  readonly container_busy_seconds: number;
  readonly container_up_seconds: number;
  readonly usd: {
    readonly workers: number;
    readonly durable_objects: number;
    readonly artifacts: number;
    readonly containers: number;
    readonly total: number;
  };
};

export type RunnerCall = {
  readonly instance: string;
  readonly startMs: number;
  readonly endMs: number;
};

export function emptyMeter(nowMs: number): InfraMeter {
  return {
    requests: 0,
    alarms: 0,
    artifactsOps: 0,
    runnerCalls: 0,
    containerBusySeconds: 0,
    containerUpSeconds: 0,
    upUntilMs: {},
    lastAtMs: nowMs,
  };
}

export function countRequest(meter: InfraMeter, nowMs: number): InfraMeter {
  return { ...meter, requests: meter.requests + 1, lastAtMs: Math.max(meter.lastAtMs, nowMs) };
}

export function countAlarm(meter: InfraMeter, nowMs: number): InfraMeter {
  return { ...meter, alarms: meter.alarms + 1, lastAtMs: Math.max(meter.lastAtMs, nowMs) };
}

export function countArtifactsOps(meter: InfraMeter, ops: number): InfraMeter {
  return { ...meter, artifactsOps: meter.artifactsOps + ops };
}

/** A runner call: its busy time, the instance's up time it adds, and its git fetch. */
export function recordRunnerCall(meter: InfraMeter, call: RunnerCall): InfraMeter {
  const tailEnd = call.endMs + RUNNER_SLEEP_AFTER_SECONDS * 1000;
  const upUntil = meter.upUntilMs[call.instance] ?? 0;
  const addedUpMs = Math.max(0, tailEnd - Math.max(call.startMs, upUntil));
  return {
    ...meter,
    runnerCalls: meter.runnerCalls + 1,
    artifactsOps: meter.artifactsOps + 1,
    containerBusySeconds: meter.containerBusySeconds + (call.endMs - call.startMs) / 1000,
    containerUpSeconds: meter.containerUpSeconds + addedUpMs / 1000,
    upUntilMs: { ...meter.upUntilMs, [call.instance]: Math.max(upUntil, tailEnd) },
    lastAtMs: Math.max(meter.lastAtMs, call.endMs),
  };
}

/** The meter's counts and their cost; `createdAtMs` starts the RunDO's active time. */
export function infraReport(meter: InfraMeter, createdAtMs: number): InfraReport {
  const activeSeconds = Math.max(0, (meter.lastAtMs - createdAtMs) / 1000);
  const doRequests = meter.requests + meter.alarms;
  const workers = meter.requests * INFRA_PRICES.workerRequestUsd;
  const durableObjects =
    doRequests * INFRA_PRICES.doRequestUsd +
    activeSeconds * DO_MEMORY_GB * INFRA_PRICES.doGbSecondUsd;
  const artifacts = meter.artifactsOps * INFRA_PRICES.artifactsOpUsd;
  const containers =
    meter.containerBusySeconds * INFRA_PRICES.containerVcpuSecondUsd +
    meter.containerUpSeconds * INFRA_PRICES.containerUpSecondUsd;
  return {
    worker_requests: meter.requests,
    do_requests: doRequests,
    do_active_seconds: roundTo(activeSeconds, 1),
    artifacts_ops: meter.artifactsOps,
    runner_calls: meter.runnerCalls,
    container_busy_seconds: roundTo(meter.containerBusySeconds, 1),
    container_up_seconds: roundTo(meter.containerUpSeconds, 1),
    usd: {
      workers: roundTo(workers, 8),
      durable_objects: roundTo(durableObjects, 8),
      artifacts: roundTo(artifacts, 8),
      containers: roundTo(containers, 8),
      total: roundTo(workers + durableObjects + artifacts + containers, 8),
    },
  };
}
