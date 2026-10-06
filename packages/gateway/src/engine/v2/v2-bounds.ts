/**
 * v2.5 tail fix: two bounds that end a bean no other rule ends. In the real races
 * `cf-v25dep-sonnet-12-s7` and `-s11`, t032 ran until the 60-minute wall cap: every card's
 * re-execution and the rescue started its rounds over, so no count reached its limit.
 *
 * - `max_bean_invocations`: the agent invocations one bean may use in all (its initial run,
 *   reworks, reconciles, test authors, re-executions, the rescue). A bean whose check fails
 *   after that many is dropped, whatever reset its rounds.
 * - `tail_guard_minutes`: when every bean still in play has failed a check and none made
 *   progress for that long (a failing set it had not seen before, or any landing), each is
 *   dropped at its next failed check, so the run ends.
 *
 * Both act only where a bean's attempt failed: it then holds no agent, no card and no job.
 * With `park`, either bound parks the bean (it needs a person) instead of dropping it.
 */
import type { InvocationKind } from '@beanstalk/shared-race/driver';
import type { TaskId } from '@beanstalk/shared-race/ids';

import type { StepContext } from '../context';
import { isTerminal } from '../tasks';
import type { BeanProgress, V2State, V2Step } from './v2-state';

/** Invocations that are a bean's agent work (a `sync` turn and a tests-first author are not). */
const COUNTED_KINDS: ReadonlySet<InvocationKind> = new Set([
  'initial',
  'rework',
  'reconcile',
  'test-author',
]);

/** What failed: a red check's failing files, or a conflict's files. */
export type FailedAttempt = {
  readonly kind: 'red' | 'conflict';
  readonly files: readonly string[];
};

/** A bean enters its landing loop: its progress clock starts. */
export function startProgress(step: V2Step, task: TaskId): void {
  const progress = (step.state.progress ??= {});
  progress[task] ??= { at: step.ctx.now, seen: [] };
}

/**
 * A dynamic-culprit search for the bean ended: the search is the engine's own work, not the
 * bean's stall, so the tail guard's clock starts again from here (a 6-probe search takes about
 * 3 minutes on the sandbox, the guard's whole budget).
 */
export function searchEnded(step: V2Step, task: TaskId): void {
  const progress = step.state.progress?.[task];
  if (progress !== undefined) progress.at = step.ctx.now;
}

/** How a bound ends a bean: dropped (v2.5), or parked for a person (`park`). */
export type BoundedEnd = { readonly kind: 'drop' | 'park'; readonly reason: string };

/**
 * A bean's attempt failed: record whether it made progress, then return how the bean must end
 * (its invocation ceiling, or the tail guard), or null to go on.
 */
export function boundedEnd(step: V2Step, task: TaskId, failed: FailedAttempt): BoundedEnd | null {
  const progress = noteFailure(step, task, failed);
  const isParking = step.state.settings.park === true;
  const ceiling = step.state.settings.maxBeanInvocations ?? 0;
  const used = invocationsOf(step.ctx, task);
  if (ceiling > 0 && used >= ceiling) {
    if (isParking) return parkFor(step, task, `still failing after ${used} attempts`);
    countDrop(step.state, 'invocation_drops');
    return {
      kind: 'drop',
      reason: `still failing after ${used} agent invocations (max_bean_invocations ${ceiling})`,
    };
  }
  const minutes = step.state.settings.tailGuardMinutes ?? 0;
  if (minutes <= 0 || !onlyStuckBeansLeft(step)) return null;
  const since = Math.max(progress.at, lastLandingAt(step.state));
  if (step.ctx.now - since < minutes * 60) return null;
  if (isParking) return parkFor(step, task, `no progress for ${minutes} minutes`);
  countDrop(step.state, 'tail_drops');
  return {
    kind: 'drop',
    reason: `no progress for ${minutes} minutes with only stuck beans left (tail_guard_minutes)`,
  };
}

/**
 * Why a bound parks a bean: a card's loser still red disagrees with the card's winner (two
 * specs disagree), whichever bound caught it first; otherwise the bound itself.
 */
function parkFor(step: V2Step, task: TaskId, bound: string): BoundedEnd {
  const winner =
    Object.values(step.state.cards).findLast((card) => card.loser === task)?.winner ?? null;
  const why = winner === null ? bound : `two specs disagree (${winner})`;
  return { kind: 'park', reason: `needs a person: ${why}` };
}

/** A failing set the bean had not seen is progress. */
function noteFailure(step: V2Step, task: TaskId, failed: FailedAttempt): BeanProgress {
  startProgress(step, task);
  const progress = step.state.progress?.[task] ?? { at: step.ctx.now, seen: [] };
  const key = `${failed.kind}:${[...failed.files].toSorted().join(',')}`;
  if (!progress.seen.includes(key)) {
    progress.seen.push(key);
    progress.at = step.ctx.now;
  }
  return progress;
}

/** Agent invocations the bean used that ran (infrastructure failures are not its work). */
function invocationsOf(ctx: StepContext, task: TaskId): number {
  return ctx.state.invRecords.filter(
    (record) =>
      record.task === task && record.infraError === null && COUNTED_KINDS.has(record.kind),
  ).length;
}

/**
 * Nothing is left to start, and every bean not yet landed has failed a check at least once:
 * the run's tail is only beans in repair.
 */
function onlyStuckBeansLeft(step: V2Step): boolean {
  const { ctx, state } = step;
  if (state.unstarted.length > 0) return false;
  return Object.values(ctx.state.tasks)
    .filter((task) => !isTerminal(task) && task.landedSha === null)
    .every((task) => (state.progress?.[task.id]?.seen.length ?? 0) > 0);
}

/** When the newest bean landed on the sprout (the run's start when none has). */
function lastLandingAt(state: V2State): number {
  return state.commits.findLast((commit) => commit.kind === 'task')?.landedAt ?? 0;
}

function countDrop(state: V2State, key: 'invocation_drops' | 'tail_drops'): void {
  state.stats[key] = (state.stats[key] ?? 0) + 1;
}
