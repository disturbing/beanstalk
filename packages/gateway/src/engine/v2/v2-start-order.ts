/**
 * Which unstarted bean a free agent takes (`start_order`). E4 found that at scale the limit
 * is how independent the work is, not the committer (`docs/claude-opus/exp/e4-scale-replay.md`),
 * so `dependency` starts beans that can land without meeting another bean first:
 *
 * - Two tasks depend on each other when their predicted footprints (`footprint.predicted`)
 *   share a module or the arena declares a coupling between them; the earlier task in
 *   priority order goes first.
 * - A bean is clear when it clashes with no bean in flight (started, not landed) and with no
 *   earlier unstarted task. Clear beans start longest dependent chain first (critical path),
 *   then in priority order.
 * - With nothing clear, the bean with the fewest clashes starts, if it clashes with at most
 *   two beans in flight; otherwise the agent waits for a landing (a chain is pipelined two
 *   deep, not run all at once). Modules most tasks predict (`src`) are ignored. Parked beans
 *   wait for a person, not a landing, so they are not in flight.
 * - Age bound: a task that clashes with no bean in flight starts next once `ageBound` later
 *   tasks have started ahead of it.
 * - Stall bound: the wait for a landing lasts at most `STALL_SECONDS` after the newest start
 *   among the beans in flight a bean clashes with; then that bean starts anyway (`stalled`),
 *   one per chain per stall, and a timer wakes the scheduler when the next bound runs out.
 *
 * `fifo` is the head of the list, as before. The choice is a pure function of the run's state.
 */
import type { TaskId } from '@beanstalk/shared-race/ids';
import { couplingPartners } from '@beanstalk/shared-race/task';

import type { StepContext } from '../context';
import { requireTask, setTimer, taskDefinition } from '../context';
import { EngineInvariantError } from '../errors';
import type { Seconds, TaskState } from '../model';

/** Later tasks that may start ahead of a task, per agent, before it goes next regardless. */
const AGE_BOUND_PER_AGENT = 1 / 2;
const MIN_AGE_BOUND = 4;
/** The age bound never exceeds this share of the run's tasks, so it fires at any agent count. */
const AGE_BOUND_TASK_SHARE = 1 / 4;
/**
 * Seconds a free agent waits for a landing in a bean's clash set before the bean starts
 * anyway: under a real bean's start to green (`cf-demo-sonnet-30-s7`: median 5.3 minutes),
 * so a stuck chain costs idle agents minutes, not half the race. Shorter holds (90 s, 120 s)
 * gave up more of the conflicts dependency starts save on the E4 chains for little gain.
 */
export const STALL_SECONDS = 180;
/** The policy timer key that wakes the scheduler when a stall bound runs out. */
export const START_WAKE_KEY = 'start-wake';
/** A bean may start alongside at most this many beans in flight it clashes with. */
const MAX_IN_FLIGHT_CLASHES = 2;
/** Share of the run's tasks above which a predicted module is a hub, not a dependency. */
const HUB_SHARE = 1 / 3;

export type StartRule =
  | 'fifo'
  | 'disjoint'
  | 'critical-path'
  | 'least-overlap'
  | 'aged'
  | 'stalled';

/** The bean to start, and the `placement.decision` fields that explain it. */
export type StartChoice = {
  readonly kind: 'start';
  readonly task: TaskId;
  readonly rule: StartRule;
  readonly overlap: readonly string[];
  readonly occupied: Readonly<Record<string, readonly string[]>>;
  readonly skipped: readonly TaskId[];
};

/** The agent waits for a landing; the scheduler looks again by `wakeAt` at the latest. */
export type StartWait = { readonly kind: 'wait'; readonly wakeAt: Seconds };

/**
 * The next bean for a free agent; `unstarted` is in priority order and not empty. `wait`:
 * the agent waits for a bean in flight to land rather than start one that would clash.
 */
export function chooseStart(
  ctx: StepContext,
  unstarted: readonly TaskId[],
  order: 'fifo' | 'dependency',
): StartChoice | StartWait {
  const head = unstarted[0];
  if (head === undefined) throw new EngineInvariantError('no unstarted bean to choose');
  if (order === 'fifo') {
    return { kind: 'start', task: head, rule: 'fifo', overlap: [], occupied: {}, skipped: [] };
  }
  return chooseByDependency(ctx, unstarted);
}

/**
 * Later tasks that may start ahead of a task before it goes next: half the agents, at least
 * 4, but at most a quarter of the tasks (at least 1). The old `2 × agents` was 60 for 30
 * agents, more starts than a 40-task run has, so it never fired.
 */
export function ageBound(agents: number, tasks: number): number {
  const byAgents = Math.max(MIN_AGE_BOUND, Math.ceil(AGE_BOUND_PER_AGENT * agents));
  return Math.min(byAgents, Math.max(1, Math.floor(AGE_BOUND_TASK_SHARE * tasks)));
}

/**
 * Makes sure a start-wake timer fires by `wakeAt` (the engine dispatches after every timer),
 * unless one already will.
 */
export function wakeForStart(ctx: StepContext, wakeAt: Seconds): void {
  const isPending = Object.values(ctx.state.timers).some(
    (timer) =>
      timer.purpose.kind === 'policy' &&
      timer.purpose.key === START_WAKE_KEY &&
      timer.at > ctx.now &&
      timer.at <= wakeAt,
  );
  if (!isPending) setTimer(ctx, wakeAt - ctx.now, { kind: 'policy', key: START_WAKE_KEY });
}

type Signals = { readonly modules: ReadonlySet<string>; readonly partners: ReadonlySet<string> };

type Candidate = {
  readonly id: TaskId;
  readonly inFlightClashes: number;
  readonly clashes: number;
  readonly height: number;
  readonly position: number;
  /** Later tasks already started ahead of this one. */
  readonly overtaken: number;
  /** When the newest bean in flight this one clashes with started (`-Infinity`: none). */
  readonly newestClashStart: Seconds;
};

type Pick = { readonly candidate: Candidate; readonly rule: StartRule };

function chooseByDependency(
  ctx: StepContext,
  unstarted: readonly TaskId[],
): StartChoice | StartWait {
  const { order } = ctx.state;
  const waiting = new Set<string>(unstarted);
  const started = order.filter((id) => !waiting.has(id));
  const inFlight = started.filter((id) => isInFlight(requireTask(ctx, id)));
  const hubs = hubModules(ctx);
  const signals = new Map(
    [...unstarted, ...inFlight].map((id) => [id, signalsOf(ctx, id, hubs)] as const),
  );
  const clash = (a: string, b: string): boolean => dependsOn(signals, a, b);
  const heights = chainHeights(unstarted, clash);
  const candidates = unstarted.map((id, index): Candidate => {
    const earlier = unstarted.slice(0, index);
    const clashingInFlight = inFlight.filter((other) => clash(id, other));
    const position = order.indexOf(id);
    return {
      id,
      inFlightClashes: clashingInFlight.length,
      clashes: clashingInFlight.length + earlier.filter((other) => clash(id, other)).length,
      height: heights[index] ?? 1,
      position,
      overtaken: started.filter((other) => order.indexOf(other) > position).length,
      newestClashStart: Math.max(
        Number.NEGATIVE_INFINITY,
        ...clashingInFlight.map((other) => requireTask(ctx, other).startedAt ?? ctx.now),
      ),
    };
  });
  const picked = pick(candidates, ctx) ?? pickStalled(candidates, ctx.now);
  // Every bean clashes with a bean in flight here, so each stall end is finite.
  if (picked === null) return { kind: 'wait', wakeAt: Math.min(...candidates.map(stallEnd)) };
  const { candidate, rule } = picked;
  return explain(ctx, { candidate, rule, inFlight, unstarted });
}

/**
 * Aged first, then clear beans by chain height, then the fewest clashes among beans that
 * clash with at most two beans in flight; `null` when every bean would meet more.
 */
function pick(candidates: readonly Candidate[], ctx: StepContext): Pick | null {
  const bound = ageBound(ctx.env.config.agents, ctx.state.order.length);
  // A bean that clashes with a bean in flight waits for it (the stall bound limits that).
  const aged = candidates.find(
    (candidate) => candidate.inFlightClashes === 0 && candidate.overtaken >= bound,
  );
  if (aged !== undefined) return { candidate: aged, rule: 'aged' };
  const clear = candidates.filter((candidate) => candidate.clashes === 0);
  if (clear.length > 0) {
    const best = clear.reduce((a, b) => (b.height > a.height ? b : a));
    const head = candidates[0];
    return { candidate: best, rule: best === head ? 'disjoint' : 'critical-path' };
  }
  const startable = candidates.filter(
    (candidate) => candidate.inFlightClashes <= MAX_IN_FLIGHT_CLASHES,
  );
  if (startable.length === 0) return null;
  const best = startable.reduce((a, b) =>
    b.clashes < a.clashes || (b.clashes === a.clashes && b.height > a.height) ? b : a,
  );
  return { candidate: best, rule: 'least-overlap' };
}

/**
 * The wait for a landing is bounded: a bean whose clashing beans in flight all started at
 * least `STALL_SECONDS` ago starts anyway, fewest clashes first, then priority order. It is
 * then the newest start in its chain, so a stuck chain takes one more bean per stall.
 */
function pickStalled(candidates: readonly Candidate[], now: Seconds): Pick | null {
  const stalled = candidates.filter((candidate) => stallEnd(candidate) <= now);
  if (stalled.length === 0) return null;
  const best = stalled.reduce((a, b) => (b.clashes < a.clashes ? b : a));
  return { candidate: best, rule: 'stalled' };
}

function stallEnd(candidate: Candidate): Seconds {
  return candidate.newestClashStart + STALL_SECONDS;
}

/**
 * The longest chain of dependent tasks each unstarted task heads (itself included), over
 * later tasks in priority order.
 */
function chainHeights(
  unstarted: readonly TaskId[],
  clash: (a: string, b: string) => boolean,
): number[] {
  const heights: number[] = Array.from({ length: unstarted.length }, () => 1);
  for (let index = unstarted.length - 1; index >= 0; index -= 1) {
    const id = unstarted[index];
    if (id === undefined) continue;
    for (let later = index + 1; later < unstarted.length; later += 1) {
      const other = unstarted[later];
      const height = heights[later] ?? 1;
      if (other !== undefined && height + 1 > (heights[index] ?? 1) && clash(id, other)) {
        heights[index] = height + 1;
      }
    }
  }
  return heights;
}

function explain(
  ctx: StepContext,
  choice: {
    candidate: Candidate;
    rule: StartRule;
    inFlight: readonly TaskId[];
    unstarted: readonly TaskId[];
  },
): StartChoice {
  const { candidate, rule, inFlight, unstarted } = choice;
  const occupied: Record<string, TaskId[]> = {};
  for (const id of inFlight) {
    for (const module of requireTask(ctx, id).selected) (occupied[module] ??= []).push(id);
  }
  const sortedOccupied = Object.fromEntries(
    Object.entries(occupied).toSorted(([a], [b]) => (a < b ? -1 : 1)),
  );
  const predicted = requireTask(ctx, candidate.id).selected;
  return {
    kind: 'start',
    task: candidate.id,
    rule,
    overlap: predicted.filter((module) => Object.hasOwn(occupied, module)).toSorted(),
    occupied: sortedOccupied,
    skipped: unstarted.filter((id) => ctx.state.order.indexOf(id) < candidate.position),
  };
}

/**
 * Started and not yet on the sprout (landed, green or dropped beans no longer clash). A
 * parked bean waits for a person, not a landing, and the race may end without it, so it does
 * not hold its chain back (`cf-demo-sonnet-30-s7`: parked t023 kept billing at three in flight).
 */
function isInFlight(task: TaskState): boolean {
  return (
    task.status !== 'landed' &&
    task.status !== 'green' &&
    task.status !== 'dropped' &&
    task.status !== 'parked'
  );
}

function signalsOf(ctx: StepContext, id: TaskId, hubs: ReadonlySet<string>): Signals {
  return {
    modules: new Set(requireTask(ctx, id).selected.filter((module) => !hubs.has(module))),
    partners: new Set(couplingPartners(taskDefinition(ctx, id))),
  };
}

/**
 * Modules predicted for more than a third of the run's tasks (`src`, `(root)`): they would
 * chain nearly every task, so they order nothing and the landing path handles them.
 */
function hubModules(ctx: StepContext): Set<string> {
  const counts = new Map<string, number>();
  for (const id of ctx.state.order) {
    for (const module of requireTask(ctx, id).selected) {
      counts.set(module, (counts.get(module) ?? 0) + 1);
    }
  }
  const limit = HUB_SHARE * ctx.state.order.length;
  return new Set([...counts].filter(([, count]) => count > limit).map(([module]) => module));
}

/** A shared predicted module or a declared coupling, in either direction. */
function dependsOn(signals: ReadonlyMap<string, Signals>, a: string, b: string): boolean {
  const left = signals.get(a);
  const right = signals.get(b);
  if (left === undefined || right === undefined) return false;
  if (left.partners.has(b) || right.partners.has(a)) return true;
  for (const module of left.modules) if (right.modules.has(module)) return true;
  return false;
}
