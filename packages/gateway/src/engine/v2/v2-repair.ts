/**
 * Repair before landing, by the bean's own author (plan §6 step 4): a conflict goes back as
 * a merge to resolve (`reexecute`), a red pre-land check as an informed rework that names at
 * most two landed culprits with their intent and diff (`repair_before_landing`). The third
 * red against the same culprit opens a decision card instead, unless that pair was decided.
 * With `release_on_check` the rework waits for a free slot and resumes the author's session.
 */
import type { Sha, SlotId, TaskId } from '@beanstalk/shared-race/ids';

import { failingTestNames } from '../ci';
import { emit, requireTask, startJob, taskDefinition } from '../context';
import { canResume, createInvocation } from '../invocations';
import type { CheckResult, JobResult } from '../model';
import { informedRedPrompt, reworkConflictPrompt } from '../prompts';
import type { CulpritContext } from '../prompts';
import { SPROUT_REF } from '../refs';
import { taskWorkspace } from '../tasks';
import { requestAgent } from './v2-agents';
import { beanAcceptance, carriedPaths } from './v2-amendments';
import { isDecided, openCard, pairKey } from './v2-decisions';
import { awaitOutcome, lastTaskCommit, sproutIndex } from './v2-sprout';
import type { AgentWork, LandingFlow, V2Step } from './v2-state';

/** Landed changes an informed rework names (`[:2]`). */
const MAX_CULPRITS = 2;
/** Red pre-land checks against one culprit that open a decision card (`>= 3`). */
const CARD_AFTER_REDS = 3;
/** Characters of each culprit's diff in the prompt (`diff_text(limit=5000)`). */
export const CULPRIT_DIFF_CHARS = 5000;
/** Failing tests quoted in an informed rework (`[:20]`). */
const REWORK_FAILING_TESTS = 20;
/** How the harness names the line in a conflict prompt (`rework_conflict(..., "the trunk")`). */
const CONFLICT_TARGET = 'the trunk';
/** What an informed rework shows for a culprit's diff that cannot be read. */
const DIFF_UNAVAILABLE = '(diff unavailable)';
/** The diff text of a culprit with no landed commit. */
const NOT_LANDED = '(not on trunk)';

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
  const definition = taskDefinition(ctx, flow.task);
  const resumed = canResume(ctx, task);
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
    prompt: reworkConflictPrompt(definition, work.files, CONFLICT_TARGET, resumed),
    freshPrompt: reworkConflictPrompt(definition, work.files, CONFLICT_TARGET, false),
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
 * A red pre-land check: name the culprits, count the pair, and either open a decision
 * card or fetch the culprits' diffs for an informed rework.
 */
export function startRepair(step: V2Step, flow: LandingFlow, head: Sha, red: CheckResult): void {
  const { state } = step;
  const culprits = culpritTasks(step, flow.task, red);
  for (const culprit of culprits) {
    const key = pairKey(flow.task, culprit);
    state.pairReds[key] = (state.pairReds[key] ?? 0) + 1;
  }
  const stuck = culprits.filter(
    (culprit) =>
      (state.pairReds[pairKey(flow.task, culprit)] ?? 0) >= CARD_AFTER_REDS &&
      !isDecided(state, flow.task, culprit),
  );
  const unreconciled = stuck.find(
    (culprit) =>
      step.ctx.env.config.reconcile && !state.reconciledPairs[pairKey(flow.task, culprit)],
  );
  if (unreconciled !== undefined) {
    requestAgent(step, flow, { kind: 'reconcile', against: unreconciled, red, head });
    return;
  }
  if (stuck.length > 0) {
    openCard(step, flow, { against: stuck, red, head });
    return;
  }
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
 * `culprit_tasks`: owners of failing acceptance tests first, then landed beans since the
 * bean's snapshot whose writes intersect the failing tests' read set; at most two.
 */
export function culpritTasks(step: V2Step, task: TaskId, red: CheckResult): TaskId[] {
  const { ctx, state } = step;
  const owners = acceptanceOwners(step);
  const named: TaskId[] = [];
  for (const path of red.failingFiles ?? []) {
    const owner = owners.get(path);
    if (owner !== undefined && owner !== task) named.push(owner);
  }
  const read = new Set(red.readSet);
  const snapshot = sproutIndex(state, requireTask(ctx, task).baseSha);
  for (const commit of state.commits.slice(snapshot + 1).toReversed()) {
    const culprit = commit.task;
    if (commit.kind !== 'task' || culprit === null || culprit === task || commit.reverted) continue;
    if (commit.files.some((path) => read.has(path))) named.push(culprit);
  }
  return [...new Set(named)].slice(0, MAX_CULPRITS);
}

/** Acceptance test path → the landed (not dropped) task that owns it; later tasks win. */
function acceptanceOwners(step: V2Step): Map<string, TaskId> {
  const { ctx } = step;
  const owners = new Map<string, TaskId>();
  for (const id of ctx.state.order) {
    const task = ctx.state.tasks[id];
    if (task === undefined || task.landedSha === null || task.status === 'dropped') continue;
    for (const path of Object.keys(taskDefinition(ctx, id).acceptance_tests)) owners.set(path, id);
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
  const definition = taskDefinition(ctx, flow.task);
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
