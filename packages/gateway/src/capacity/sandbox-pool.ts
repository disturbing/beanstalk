/**
 * The runner pool's sharing rule: who may start another runner instance. Pure; the
 * `RunnerCapacity` Durable Object holds the state and applies the decisions.
 *
 * Every runner instance of every run and repository comes out of one container class whose
 * `max_instances` (48 live) is shared. A race needs `agents + ci_slots + 1` instances for its
 * whole life and reserves them when it starts. A repository engine keeps its committer and CI
 * slots (its `base`) and leases one pre-land sandbox per bean in check, on demand:
 *
 * - **floor:** an engine below `floor` leases is always granted one, so neither races nor a
 *   busier repository can stop a repository's checks (two sandboxes: the old shared pool);
 * - **cap:** an engine never holds more than its own `cap` (`preland_sandboxes`);
 * - **pool:** above the floor, a lease is granted only while races' reservations, active
 *   engines' bases and every lease fit under `instances - headroom`, so a busy repository
 *   cannot take what a race reserved;
 * - **fair share:** while another engine waits for a sandbox, an engine at or above an equal
 *   share of the repositories' part of the pool gets no more, so one repository cannot starve
 *   another.
 *
 * Leases end when the check ends; an idle sandbox then sleeps (`sleepAfter`) and leaves the pool.
 */

/** Pool sizes: the container class's `max_instances`, instances kept free, and the floor. */
export type PoolLimits = {
  readonly instances: number;
  readonly headroom: number;
  readonly floor: number;
  /**
   * The Actions job container class's `max_instances` (the executor Worker's
   * ActionsJobContainer). Leases of `actions:<repo>` owners count against it, not against the
   * runner pool above; absent, Actions jobs get no instances.
   */
  readonly actionsInstances?: number;
};

/** Owners whose leases are Actions job containers (`actions:<repo id>`, lane 1's run DO). */
export const ACTIONS_OWNER_PREFIX = 'actions:';

/** A race's instances, held from its start until it is done (or `untilMs`, if it never says so). */
export type RaceReservation = {
  readonly run: string;
  readonly instances: number;
  readonly untilMs: number;
};

/** One pre-land sandbox of a repository engine, held by one check job. */
export type SandboxLease = {
  readonly engine: string;
  readonly job: string;
  readonly index: number;
  readonly untilMs: number;
};

/** What the pool knows of a repository engine: its standing instances and when it last asked. */
export type EngineSeen = {
  readonly engine: string;
  readonly base: number;
  readonly seenMs: number;
  /** When it last had to wait for a sandbox (null: it is not waiting). */
  readonly waitingMs: number | null;
};

export type PoolState = {
  readonly races: readonly RaceReservation[];
  readonly leases: readonly SandboxLease[];
  readonly engines: readonly EngineSeen[];
};

/** A check job of `engine` asks for a sandbox. */
export type LeaseRequest = {
  readonly engine: string;
  readonly job: string;
  /** The engine's `preland_sandboxes`. */
  readonly cap: number;
  /** The engine's committer and CI slots. */
  readonly base: number;
  readonly nowMs: number;
};

export type WaitReason = 'cap' | 'pool' | 'fair-share';

export type LeaseDecision =
  | { readonly kind: 'granted'; readonly index: number; readonly isRenewal: boolean }
  | { readonly kind: 'wait'; readonly reason: WaitReason };

/** An engine counts as active (its base is up) this long after it last asked for a sandbox. */
export const ENGINE_ACTIVE_MS = 5 * 60 * 1000;
/** An engine that had to wait counts as waiting this long (it asks again every few seconds). */
export const WAITING_FRESH_MS = 15 * 1000;

/** Decides one lease request against the pool (expired entries already removed). */
export function decideLease(
  state: PoolState,
  request: LeaseRequest,
  limits: PoolLimits,
): LeaseDecision {
  const held = state.leases.find(
    (lease) => lease.engine === request.engine && lease.job === request.job,
  );
  if (held !== undefined) return { kind: 'granted', index: held.index, isRenewal: true };
  if (isActionsOwner(request.engine)) return decideActionsLease(state, request, limits);
  return decideRunnerLease(withoutActions(state), request, limits);
}

/**
 * An Actions job's container (one per job, D6): within the repository's cap (its concurrent
 * jobs), within the Actions class's `max_instances`, and, while another repository waits with
 * fewer, no more than an equal share of it. Runner pool races and checks are not involved: the
 * two container classes have their own limits.
 */
export function decideActionsLease(
  state: PoolState,
  request: LeaseRequest,
  limits: PoolLimits,
): LeaseDecision {
  const actions = state.leases.filter((lease) => isActionsOwner(lease.engine));
  const mine = actions.filter((lease) => lease.engine === request.engine);
  if (mine.length >= request.cap) return { kind: 'wait', reason: 'cap' };
  const budget = limits.actionsInstances ?? 0;
  if (actions.length >= budget) return { kind: 'wait', reason: 'pool' };
  const actionsState: PoolState = {
    races: [],
    leases: actions,
    engines: state.engines.filter((engine) => isActionsOwner(engine.engine)),
  };
  const share = fairShare(actionsState, request, { budget, floor: 1 });
  if (mine.length >= share && othersWaiting(actionsState, request)) {
    return { kind: 'wait', reason: 'fair-share' };
  }
  return { kind: 'granted', index: freeIndex(mine), isRenewal: false };
}

export function isActionsOwner(engine: string): boolean {
  return engine.startsWith(ACTIONS_OWNER_PREFIX);
}

function withoutActions(state: PoolState): PoolState {
  return {
    races: state.races,
    leases: state.leases.filter((lease) => !isActionsOwner(lease.engine)),
    engines: state.engines.filter((engine) => !isActionsOwner(engine.engine)),
  };
}

function decideRunnerLease(
  state: PoolState,
  request: LeaseRequest,
  limits: PoolLimits,
): LeaseDecision {
  const mine = state.leases.filter((lease) => lease.engine === request.engine);
  if (mine.length >= request.cap) return { kind: 'wait', reason: 'cap' };
  const granted = { kind: 'granted', index: freeIndex(mine), isRenewal: false } as const;
  if (mine.length < limits.floor) return granted;
  const budget = leaseBudget(state, request, limits);
  if (state.leases.length >= budget) return { kind: 'wait', reason: 'pool' };
  if (mine.length >= fairShare(state, request, { budget, floor: limits.floor })) {
    if (othersWaiting(state, request)) return { kind: 'wait', reason: 'fair-share' };
  }
  return granted;
}

/** Instances the repositories' sandboxes may use: the pool less races, headroom and bases. */
export function leaseBudget(state: PoolState, request: LeaseRequest, limits: PoolLimits): number {
  const races = state.races.reduce((sum, race) => sum + race.instances, 0);
  const bases = activeEngines(state, request).reduce((sum, engine) => sum + engine.base, 0);
  return limits.instances - limits.headroom - races - bases;
}

/** Engines whose standing instances count: the requester, and any that asked recently. */
function activeEngines(state: PoolState, request: LeaseRequest): readonly EngineSeen[] {
  const others = state.engines.filter(
    (engine) =>
      engine.engine !== request.engine &&
      (request.nowMs - engine.seenMs < ENGINE_ACTIVE_MS ||
        state.leases.some((lease) => lease.engine === engine.engine)),
  );
  return [
    ...others,
    { engine: request.engine, base: request.base, seenMs: request.nowMs, waitingMs: null },
  ];
}

/** An equal part of the lease budget among the engines that hold or want sandboxes. */
function fairShare(
  state: PoolState,
  request: LeaseRequest,
  sizes: { budget: number; floor: number },
): number {
  const wanting = new Set([request.engine]);
  for (const lease of state.leases) wanting.add(lease.engine);
  for (const engine of state.engines)
    if (isWaiting(engine, request.nowMs)) wanting.add(engine.engine);
  return Math.max(sizes.floor, Math.floor(sizes.budget / wanting.size));
}

/** Whether another engine waits for a sandbox while holding less than this one. */
function othersWaiting(state: PoolState, request: LeaseRequest): boolean {
  const held = (engine: string): number =>
    state.leases.filter((lease) => lease.engine === engine).length;
  const mine = held(request.engine);
  return state.engines.some(
    (engine) =>
      engine.engine !== request.engine &&
      isWaiting(engine, request.nowMs) &&
      held(engine.engine) < mine,
  );
}

function isWaiting(engine: EngineSeen, nowMs: number): boolean {
  return engine.waitingMs !== null && nowMs - engine.waitingMs < WAITING_FRESH_MS;
}

/** The lowest sandbox index the engine does not use, so warm sandboxes are reused first. */
function freeIndex(mine: readonly SandboxLease[]): number {
  const used = new Set(mine.map((lease) => lease.index));
  let index = 0;
  while (used.has(index)) index += 1;
  return index;
}
