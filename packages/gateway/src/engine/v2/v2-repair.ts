/**
 * Repair before landing, by the bean's own author (plan §6 step 4): a conflict goes back as
 * a merge to resolve (`reexecute`), a red pre-land check as an informed rework that names at
 * most two landed culprits with their intent and diff (`repair_before_landing`). The third
 * red against the same culprit opens a decision card instead, unless that pair was decided.
 * v2.5 (`escalate_after: 1`) escalates sooner: once a failing test file fails again against a
 * culprit after one informed repair, the bean goes to reconcile, then to a card; a culprit
 * already reconciled and decided drops the bean instead of spending the remaining rounds
 * (with `rescue`, the bean is first re-executed once from scratch).
 * With `release_on_check` the rework waits for a free slot and resumes the author's session.
 */
import type { Sha, SlotId, TaskId } from '@beanstalk/shared-race/ids';

import { failingTestNames } from '../ci';
import {
  acceptanceTests,
  emit,
  promptTask,
  requireTask,
  startJob,
  taskDefinition,
} from '../context';
import { canResume, createInvocation } from '../invocations';
import type { CheckResult, JobResult } from '../model';
import { informedConflictPrompt, informedRedPrompt } from '../prompts';
import type { ConflictAuthor, ConflictContext, CulpritContext } from '../prompts';
import { SPROUT_REF } from '../refs';
import { taskWorkspace } from '../tasks';
import { requestAgent } from './v2-agents';
import { beanAcceptance, carriedPaths } from './v2-amendments';
import { isDecided, isReconciled, openCard, pairKey } from './v2-decisions';
import { endLanding, parkLanding, parks } from './v2-flows';
import { awaitOutcome, lastTaskCommit, sproutIndex } from './v2-sprout';
import { rescueOnExhaustion } from './v2-rescue';
import { brokeTogether } from './v2-reset';
import { cardAfterReds } from './v2-start';
import { takeSyncNote } from './v2-sync';
import type { AgentWork, LandingFlow, SproutCommit, V2State, V2Step } from './v2-state';

/** Landed changes an informed rework names (`[:2]`). */
const MAX_CULPRITS = 2;
/** Red pre-land checks against one culprit that open a decision card (`>= 3`). */
const CARD_AFTER_REDS = 3;
/** Characters of each culprit's diff in the prompt (`diff_text(limit=5000)`). */
export const CULPRIT_DIFF_CHARS = 5000;
/** Failing tests quoted in an informed rework (`[:20]`). */
const REWORK_FAILING_TESTS = 20;
/** Landed beans a conflict rework names as the other side's authors. */
const MAX_CONFLICT_AUTHORS = 3;
/** What an informed rework shows for a culprit's diff that cannot be read. */
const DIFF_UNAVAILABLE = '(diff unavailable)';
/** The diff text of a culprit with no landed commit. */
const NOT_LANDED = '(not on trunk)';

/**
 * A red pre-land check: the sprout it ran on, its result and the bean's changed files, and
 * (v2.5 `dynamic_culprits`) the landed beans a leave-one-out search confirmed.
 */
export type RedCheck = {
  readonly head: Sha;
  readonly red: CheckResult;
  readonly mine: readonly string[] | null;
  readonly confirmed?: readonly TaskId[];
};

type ConflictWork = Extract<AgentWork, { kind: 'conflict' }>;
type InformedWork = Extract<AgentWork, { kind: 'informed' }>;

/** A conflict with the sprout head: the author resolves the merge of it (`reexecute`). */
export function startConflictRework(
  step: V2Step,
  flow: LandingFlow,
  slot: SlotId,
  work: ConflictWork,
): void {
  const { ctx } = step;
  const task = requireTask(ctx, flow.task);
  const definition = promptTask(ctx, flow.task);
  const resumed = canResume(ctx, task);
  const conflict = conflictContext(step, flow.task, work);
  const note = takeSyncNote(flow);
  task.reworks += 1;
  task.status = 'rework';
  emit(ctx, 'rework.start', {
    task: flow.task,
    ticket: null,
    reason: 'conflict',
    conflicts: [...work.files],
    attempt: flow.rounds,
    resumed,
  });
  flow.step = { kind: 'rework', reason: 'conflict' };
  createInvocation(ctx, {
    kind: 'rework',
    task: flow.task,
    slot,
    attempt: flow.rounds,
    prompt: note + informedConflictPrompt(definition, conflict, resumed),
    freshPrompt: note + informedConflictPrompt(definition, conflict, false),
    resume: resumed ? task.sessionId : null,
    workspace: (inv) =>
      taskWorkspace(ctx, task, {
        kind: 'rework',
        inv,
        merge: { sha: work.head, ref: SPROUT_REF, conflicts: [...work.files] },
        acceptance: beanAcceptance(step, flow.task),
        unprotect: carriedPaths(step, flow.task),
      }),
    replay: { reset_to: work.head, check: 'acceptance', fixes: [] },
  });
}

/**
 * The hunks of a conflict and the landed beans behind the sprout's side: the newest first
 * among those that landed after the bean last merged the sprout and wrote a conflicted file.
 */
function conflictContext(step: V2Step, task: TaskId, work: ConflictWork): ConflictContext {
  const { ctx, state } = step;
  const since = sproutIndex(state, requireTask(ctx, task).mergedMain);
  const conflicted = new Set(work.files);
  const authors: ConflictAuthor[] = [];
  for (const commit of state.commits.slice(since + 1).toReversed()) {
    const author = commit.task;
    const paths = commit.files.filter((path) => conflicted.has(path));
    const isOtherBean = commit.kind === 'task' && author !== null && author !== task;
    if (!isOtherBean || commit.reverted || paths.length === 0) continue;
    if (authors.some((known) => known.task === author)) continue;
    const definition = taskDefinition(ctx, author);
    authors.push({ task: author, title: definition.title, intent: definition.prompt, paths });
    if (authors.length === MAX_CONFLICT_AUTHORS) break;
  }
  return { files: work.files, hunks: work.hunks, authors };
}

/**
 * A red pre-land check: name the culprits, count the pair, and either open a decision
 * card or fetch the culprits' diffs for an informed rework. `failure.confirmed` (v2.5
 * dynamic culprits) replaces the read-set guess. A declared partner (`start_cards`) is stuck
 * at its first red.
 */
export function startRepair(step: V2Step, flow: LandingFlow, failure: RedCheck): void {
  const { state } = step;
  const { head, red } = failure;
  const culprits = culpritTasks(step, flow.task, failure);
  for (const culprit of culprits) {
    const key = pairKey(flow.task, culprit);
    state.pairReds[key] = (state.pairReds[key] ?? 0) + 1;
  }
  const repeated = new Set(
    state.settings.escalateAfter < CARD_AFTER_REDS - 1
      ? repeatedCulprits(step, flow.task, red, culprits)
      : [],
  );
  const stuck = culprits.filter(
    (culprit) =>
      repeated.has(culprit) ||
      (brokeTogether(step, flow.task, culprit) && !isDecided(state, flow.task, culprit)) ||
      ((state.pairReds[pairKey(flow.task, culprit)] ?? 0) >=
        cardAfterReds(step, flow.task, culprit, CARD_AFTER_REDS) &&
        !isDecided(state, flow.task, culprit)),
  );
  const unreconciled = stuck.find(
    (culprit) => step.ctx.env.config.reconcile && !isReconciled(state, flow.task, culprit),
  );
  if (unreconciled !== undefined) {
    const parties = reconcileParties(step, flow.task, failure, unreconciled);
    requestAgent(step, flow, { kind: 'reconcile', against: unreconciled, parties, red, head });
    return;
  }
  const undecided = stuck.filter((culprit) => !isDecided(state, flow.task, culprit));
  if (undecided.length > 0) {
    openCard(step, flow, { against: undecided, red, head });
    return;
  }
  const decided = stuck[0];
  if (decided !== undefined && parks(state)) {
    // The card decided and the re-execution is still red against it: only a person can tell
    // which spec is wrong, so no rescue and no more rounds.
    parkLanding(step, flow.task, `needs a person: two specs disagree (${decided})`);
    return;
  }
  if (decided !== undefined) {
    if (rescueOnExhaustion(step, flow, red)) {
      forgetRepeats(state, flow.task);
      return;
    }
    state.stats.stuck_drops += 1;
    state.stats.preland_drops += 1;
    endLanding(
      step,
      flow.task,
      `pre-land check still red against ${decided} after its decision card`,
    );
    return;
  }
  startInformedRepair(step, flow, { head, red, culprits });
}

/** Fetches the culprits' diffs, then sends the informed rework (`repair_before_landing`). */
export function startInformedRepair(
  step: V2Step,
  flow: LandingFlow,
  repair: { head: Sha; red: CheckResult; culprits: readonly TaskId[] },
): void {
  const { state } = step;
  const { head, red } = repair;
  const culprits = [...repair.culprits];
  const diffs: Record<string, string> = {};
  flow.step = { kind: 'diffs', head, red, culprits, diffs };
  for (const culprit of culprits) {
    const commit = lastTaskCommit(state, culprit);
    if (commit === undefined) {
      diffs[culprit] = NOT_LANDED;
      continue;
    }
    const jobId = startJob(
      step.ctx,
      { kind: 'diff', parent: commit.parent, sha: commit.sha, limit: CULPRIT_DIFF_CHARS },
      { kind: 'policy' },
    );
    awaitOutcome(state, jobId, { kind: 'diff', task: flow.task, culprit });
  }
  reworkWhenInformed(step, flow);
}

/** A culprit's diff arrived. */
export function onCulpritDiff(
  step: V2Step,
  wait: { task: TaskId; culprit: TaskId },
  result: JobResult,
): void {
  const flow = step.state.landings[wait.task];
  if (flow?.step.kind !== 'diffs' || result.kind !== 'diff') return;
  flow.step.diffs[wait.culprit] = result.text;
  reworkWhenInformed(step, flow);
}

/** A culprit's diff could not be read: the rework still goes out, with a note instead. */
export function onCulpritDiffFailed(step: V2Step, wait: { task: TaskId; culprit: TaskId }): void {
  onCulpritDiff(step, wait, { kind: 'diff', text: DIFF_UNAVAILABLE });
}

/**
 * v2.5: the culprits a bean is stuck against. A red repeats against a culprit when one of its
 * failing test files failed in the previous red against it too; after `escalate_after`
 * repeats, or v2.4's third red of an undecided pair, the pair is stuck. A card does not reset
 * the count (the tail fix): a re-executed loser red again on the file its card was raised on
 * is stuck against the decided counterpart at once, so the drop after the card fires (t032 in
 * `cf-v25dep-sonnet-12-s7` got a fresh informed repair after its card, and another after its
 * rescue, each behind a dynamic-culprit search).
 */
function repeatedCulprits(
  step: V2Step,
  task: TaskId,
  red: CheckResult,
  culprits: readonly TaskId[],
): TaskId[] {
  const { state } = step;
  const files = [...(red.failingFiles ?? [])];
  return culprits.filter((culprit) => {
    const key = pairKey(task, culprit);
    const decided = isDecided(state, task, culprit);
    const last = state.pairRepeats[key];
    const isRepeat = last !== undefined && files.some((file) => last.files.includes(file));
    const repeats = isRepeat ? last.repeats + 1 : 0;
    state.pairRepeats[key] = { files, repeats };
    const isThirdRed = !decided && (state.pairReds[key] ?? 0) >= CARD_AFTER_REDS;
    return repeats >= state.settings.escalateAfter || isThirdRed;
  });
}

/**
 * A rescued bean starts its repeat count over against undecided culprits (`rescue`). Against a
 * decided one it keeps it: red again on the same file after the rescue, it is dropped.
 */
function forgetRepeats(state: V2State, task: TaskId): void {
  const prefix = `${task}|`;
  for (const key of Object.keys(state.pairRepeats)) {
    if (!key.startsWith(prefix)) continue;
    // Decided either way round (`isDecided`): the pair keeps its count.
    const swapped = `${key.slice(prefix.length)}|${task}`;
    if (state.decidedPairs[key] === undefined && state.decidedPairs[swapped] === undefined) {
      delete state.pairRepeats[key];
    }
  }
}

/**
 * v2.5: the landed tasks a reconcile takes in: the stuck culprit, then the owners of the
 * failing tests and the read-set suspects since the bean's base, at most `reconcile_parties`.
 */
function reconcileParties(step: V2Step, task: TaskId, check: RedCheck, against: TaskId): TaskId[] {
  const limit = step.state.settings.reconcileParties;
  if (limit <= 1) return [against];
  return [...new Set([against, ...culpritTasks(step, task, check, limit)])].slice(0, limit);
}

/**
 * `culprit_tasks`: owners of failing acceptance tests first, then landed beans since the
 * bean's snapshot whose writes intersect the failing tests' read set; at most two (`limit`).
 * With `base_culprits`, each failing test whose read set the bean changed names, right after
 * the owners, the newest landed bean that also wrote that read set, even one already in the
 * bean's base: the bean's change is what met it.
 */
export function culpritTasks(
  step: V2Step,
  task: TaskId,
  check: RedCheck,
  limit = MAX_CULPRITS,
): TaskId[] {
  const { ctx, state } = step;
  const { red } = check;
  const owners = acceptanceOwners(step);
  const named: TaskId[] = [];
  for (const path of red.failingFiles ?? []) {
    const owner = owners.get(path);
    if (owner !== undefined && owner !== task) named.push(owner);
  }
  if (check.confirmed !== undefined) {
    const live = check.confirmed.filter((culprit) => isLiveOnSprout(state, culprit, task));
    return [...new Set([...named, ...live])].slice(0, limit);
  }
  if (ctx.env.config.base_culprits) named.push(...metCulprits(state, task, check));
  const read = new Set(red.readSet);
  const snapshot = sproutIndex(state, requireTask(ctx, task).baseSha);
  for (const commit of state.commits.slice(snapshot + 1).toReversed()) {
    if (isOtherLiveTask(commit, task) && commit.files.some((path) => read.has(path))) {
      named.push(commit.task);
    }
  }
  return [...new Set(named)].slice(0, limit);
}

/**
 * `base_culprits`: for each failing test whose read set the bean changed, the newest other
 * live bean on the sprout that wrote a file of that read set, wherever it sits.
 */
function metCulprits(state: V2State, task: TaskId, check: RedCheck): TaskId[] {
  const { red, mine } = check;
  if (mine === null) return [];
  const changed = new Set(mine);
  const met: TaskId[] = [];
  for (const test of red.failingFiles ?? []) {
    const reads = red.readSets[test] ?? [test];
    const ownReads = reads.filter((path) => changed.has(path));
    if (ownReads.length === 0 && !changed.has(test)) continue;
    const others = new Set(reads.filter((path) => !changed.has(path)));
    const culprit = state.commits.findLast(
      (commit) => isOtherLiveTask(commit, task) && commit.files.some((path) => others.has(path)),
    );
    const owner = culprit?.task;
    if (owner !== undefined && owner !== null) met.push(owner);
  }
  return met;
}

/**
 * A confirmed culprit still on the sprout: a reset or a revert since its search may have taken
 * it off, and an informed rework must not cite a bean that is no longer there.
 */
function isLiveOnSprout(state: V2State, culprit: TaskId, task: TaskId): boolean {
  return state.commits.some((commit) => isOtherLiveTask(commit, task) && commit.task === culprit);
}

function isOtherLiveTask(
  commit: SproutCommit,
  task: TaskId,
): commit is SproutCommit & { task: TaskId } {
  return commit.kind === 'task' && commit.task !== null && commit.task !== task && !commit.reverted;
}

/** Acceptance test path → the landed (not dropped) task that owns it; later tasks win. */
function acceptanceOwners(step: V2Step): Map<string, TaskId> {
  const { ctx } = step;
  const owners = new Map<string, TaskId>();
  for (const id of ctx.state.order) {
    const task = ctx.state.tasks[id];
    if (task === undefined || task.landedSha === null || task.status === 'dropped') continue;
    for (const path of Object.keys(acceptanceTests(ctx, id))) owners.set(path, id);
  }
  return owners;
}

function reworkWhenInformed(step: V2Step, flow: LandingFlow): void {
  const current = flow.step;
  if (current.kind !== 'diffs') return;
  if (current.culprits.some((culprit) => current.diffs[culprit] === undefined)) return;
  const { head, red, culprits, diffs } = current;
  requestAgent(step, flow, { kind: 'informed', head, red, culprits, diffs });
}

/** The informed rework itself: the same session, the failures and the culprits' context. */
export function startInformedRework(
  step: V2Step,
  flow: LandingFlow,
  slot: SlotId,
  work: InformedWork,
): void {
  const { ctx, state } = step;
  const task = requireTask(ctx, flow.task);
  const definition = promptTask(ctx, flow.task);
  const { head, red, culprits } = work;
  const named = failingTestNames(red).slice(0, REWORK_FAILING_TESTS);
  const failing = named.length > 0 ? named : [...(red.failingFiles ?? [])];
  const context: CulpritContext[] = culprits.map((culprit) => {
    const landed = taskDefinition(ctx, culprit);
    return {
      task: culprit,
      title: landed.title,
      intent: landed.prompt,
      diff: work.diffs[culprit] ?? NOT_LANDED,
    };
  });
  const resumed = canResume(ctx, task);
  task.reworks += 1;
  task.status = 'rework';
  state.stats.preland_reworks += 1;
  if (culprits.length > 0) state.stats.informed_reworks += 1;
  emit(ctx, 'rework.start', {
    task: flow.task,
    ticket: null,
    reason: 'preland-red',
    failing,
    attempt: flow.rounds,
    resumed,
    culprits: [...culprits],
  });
  flow.step = { kind: 'rework', reason: 'preland-red' };
  createInvocation(ctx, {
    kind: 'rework',
    task: flow.task,
    slot,
    attempt: flow.rounds,
    prompt: informedRedPrompt(definition, failing, red.output, context, resumed),
    freshPrompt: informedRedPrompt(definition, failing, red.output, context, false),
    resume: resumed ? task.sessionId : null,
    workspace: (inv) =>
      taskWorkspace(ctx, task, {
        kind: 'rework',
        inv,
        merge: { sha: head, ref: SPROUT_REF, conflicts: [] },
        acceptance: beanAcceptance(step, flow.task),
        unprotect: carriedPaths(step, flow.task),
      }),
    replay: { reset_to: head, check: 'acceptance', fixes: [] },
  });
}
