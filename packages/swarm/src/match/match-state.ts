import type { Credential } from './match-schema';

export type MatchPhase = 'starting' | 'ready' | 'running' | 'halted' | 'done';

export type AgentRecord = {
  readonly slot: string;
  /** When the swarm asked Cloudflare for the container (ms since epoch). */
  started_at: number | null;
  /** The slot driver's first request (`POST /v1/hello`): the container is up and Python runs. */
  hello_at: number | null;
  exited_at: number | null;
  exit_code: number | null;
  codex_version: string | null;
  /** sha256 (12 hex) of the image's race driver, to tell which image a container runs. */
  harness: string | null;
  /** `exit` (the driver ended) or `runtime_signal` (the platform stopped it), from onStop. */
  stop_reason: string | null;
  start_error: string | null;
  /** Stops seen before the driver's hello (start attempts the container library retried). */
  restarts: number;
};

export type MatchState = {
  readonly match: string;
  readonly created_at: number;
  phase: MatchPhase;
  reason: string | null;
  readonly gateway_run: string;
  readonly credential: Credential;
  readonly max_usd: number | null;
  readonly driver: Readonly<Record<string, unknown>>;
  agents: Record<string, AgentRecord>;
  released_at: number | null;
  /** Latest reported cost per invocation (progress estimates, then the result's cost). */
  spend: Record<string, number>;
};

/**
 * Container list prices for `standard-3` (2 vCPU, 8 GiB memory, 16 GB disk), Workers Paid,
 * developers.cloudflare.com/containers/pricing (2026-10-06): memory and disk are billed while
 * provisioned, CPU only while active. The cap uses the upper bound (CPU busy all the time).
 */
export const STANDARD_3 = { vcpu: 2, memoryGib: 8, diskGb: 16 } as const;
const USD_PER_GIB_SECOND = 0.0000025;
const USD_PER_VCPU_SECOND = 0.00002;
const USD_PER_GB_DISK_SECOND = 0.00000007;

export type ContainerCost = {
  readonly seconds: number;
  /** Memory and disk only (CPU idle). */
  readonly provisioned: number;
  /** Memory, disk and every vCPU busy throughout. */
  readonly upper: number;
};

export function containerCost(agents: readonly AgentRecord[], now: number): ContainerCost {
  const seconds = agents.reduce((sum, agent) => sum + agentSeconds(agent, now), 0);
  const provisioned =
    seconds *
    (STANDARD_3.memoryGib * USD_PER_GIB_SECOND + STANDARD_3.diskGb * USD_PER_GB_DISK_SECOND);
  return {
    seconds: round(seconds, 1),
    provisioned: round(provisioned, 6),
    upper: round(provisioned + seconds * STANDARD_3.vcpu * USD_PER_VCPU_SECOND, 6),
  };
}

function agentSeconds(agent: AgentRecord, now: number): number {
  if (agent.started_at === null) return 0;
  return Math.max(0, ((agent.exited_at ?? now) - agent.started_at) / 1000);
}

export function agentSpend(spend: Readonly<Record<string, number>>): number {
  return round(
    Object.values(spend).reduce((sum, usd) => sum + usd, 0),
    6,
  );
}

export type ColdStart = {
  readonly median: number | null;
  readonly max: number | null;
  readonly each: Readonly<Record<string, number>>;
};

/** Container start request → the driver's hello, per agent, in milliseconds. */
export function coldStarts(agents: readonly AgentRecord[]): ColdStart {
  const each: Record<string, number> = {};
  for (const agent of agents) {
    if (agent.started_at !== null && agent.hello_at !== null) {
      each[agent.slot] = agent.hello_at - agent.started_at;
    }
  }
  const sorted = Object.values(each).toSorted((a, b) => a - b);
  return { median: median(sorted), max: sorted.at(-1) ?? null, each };
}

function median(sorted: readonly number[]): number | null {
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] ?? upper) + upper) / 2;
}

/** Whether a match's spend (agents plus the containers' upper bound) reached its cap. */
export function overCap(state: MatchState, now: number): boolean {
  if (state.max_usd === null) return false;
  const total = agentSpend(state.spend) + containerCost(Object.values(state.agents), now).upper;
  return total >= state.max_usd;
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
