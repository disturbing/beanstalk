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
 *   deep, not run all at once). Modules most tasks predict (`src`) are ignored.
 * - Age bound: a task passed over by `ageBound` starts more than its FIFO turn starts next.
 *
 * `fifo` is the head of the list, as before. The choice is a pure function of the run's state.
 */
import type { TaskId } from '@beanstalk/shared-race/ids';
import { couplingPartners } from '@beanstalk/shared-race/task';

import type { StepContext } from '../context';
import { requireTask, taskDefinition } from '../context';
import { EngineInvariantError } from '../errors';
import type { TaskState } from '../model';

/** Starts a task may fall behind its FIFO turn, per agent, before it goes next regardless. */
const AGE_BOUND_PER_AGENT = 2;
const MIN_AGE_BOUND = 4;
/** A bean may start alongside at most this many beans in flight it clashes with. */
const MAX_IN_FLIGHT_CLASHES = 2;
/** Share of the run's tasks above which a predicted module is a hub, not a dependency. */
const HUB_SHARE = 1 / 3;

export type StartRule = 'fifo' | 'disjoint' | 'critical-path' | 'least-overlap' | 'aged';

/** The bean to start, and the `placement.decision` fields that explain it. */
export type StartChoice = {
  readonly task: TaskId;
  readonly rule: StartRule;
  readonly overlap: readonly string[];
  readonly occupied: Readonly<Record<string, readonly string[]>>;
  readonly skipped: readonly TaskId[];
};

/**
 * The next bean for a free agent; `unstarted` is in priority order and not empty. `null`:
 * the agent waits for a bean in flight to land rather than start one that would clash.
 */
export function chooseStart(
  ctx: StepContext,
  unstarted: readonly TaskId[],
  order: 'fifo' | 'dependency',
): StartChoice | null {
  const head = unstarted[0];
  if (head === undefined) throw new EngineInvariantError('no unstarted bean to choose');
  if (order === 'fifo') {
    return { task: head, rule: 'fifo', overlap: [], occupied: {}, skipped: [] };
  }
  return chooseByDependency(ctx, unstarted);
}

/** Starts a task may lag its FIFO turn before it goes next: twice the agents, at least 4. */
export function ageBound(agents: number): number {
  return Math.max(MIN_AGE_BOUND, AGE_BOUND_PER_AGENT * agents);
}

type Signals = { readonly modules: ReadonlySet<string>; readonly partners: ReadonlySet<string> };

type Candidate = {
  readonly id: TaskId;
  readonly inFlightClashes: number;
  readonly clashes: number;
  readonly height: number;
  readonly position: number;
};

function chooseByDependency(ctx: StepContext, unstarted: readonly TaskId[]): StartChoice | null {
  const { order } = ctx.state;
  const waiting = new Set<string>(unstarted);
  const inFlight = order.filter((id) => !waiting.has(id) && isInFlight(requireTask(ctx, id)));
  const hubs = hubModules(ctx);
  const signals = new Map(
    [...unstarted, ...inFlight].map((id) => [id, signalsOf(ctx, id, hubs)] as const),
  );
  const clash = (a: string, b: string): boolean => dependsOn(signals, a, b);
  const heights = chainHeights(unstarted, clash);
  const candidates = unstarted.map((id, index): Candidate => {
    const earlier = unstarted.slice(0, index);
    const inFlightClashes = inFlight.filter((other) => clash(id, other)).length;
    const clashes = inFlightClashes + earlier.filter((other) => clash(id, other)).length;
    const position = order.indexOf(id);
    return { id, inFlightClashes, clashes, height: heights[index] ?? 1, position };
  });
  const picked = pick(candidates, ctx);
  if (picked === null) return null;
  const { candidate, rule } = picked;
  return explain(ctx, { candidate, rule, inFlight, unstarted });
}

/**
 * Aged first, then clear beans by chain height, then the fewest clashes among beans that
 * clash with at most two beans in flight; `null` when every bean would meet more.
 */
function pick(
  candidates: readonly Candidate[],
  ctx: StepContext,
): { candidate: Candidate; rule: StartRule } | null {
  const started = ctx.state.order.length - candidates.length;
  const bound = ageBound(ctx.env.config.agents);
  const aged = candidates.find((candidate) => started - candidate.position >= bound);
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
    task: candidate.id,
    rule,
    overlap: predicted.filter((module) => Object.hasOwn(occupied, module)).toSorted(),
    occupied: sortedOccupied,
    skipped: unstarted.filter((id) => ctx.state.order.indexOf(id) < candidate.position),
  };
}

/** Started and not yet on the sprout (landed, green or dropped beans no longer clash). */
function isInFlight(task: TaskState): boolean {
  return task.status !== 'landed' && task.status !== 'green' && task.status !== 'dropped';
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
