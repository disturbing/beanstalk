/**
 * Live sprout sync (`live_sync`, opt-in). When a bean lands, beans whose agents were working
 * meanwhile get it at their next safe point. A `claude -p` session cannot be interrupted, so
 * the safe point is the end of the bean's current invocation: its first squash afterwards
 * merges every sprout that landed meanwhile and tells which of those meet the bean.
 *
 * - Clean: before the pre-land check, the bean's own agent (still held, its session resumed)
 *   gets a short `sync` turn with the new sprout merged into its branch: re-run the tests,
 *   fix what the merge broke, otherwise change nothing (`sync.applied`). Then the bean squashes
 *   and is checked as usual. No round is spent.
 * - Conflict: nothing is merged; the conflict rework's prompt opens with a note naming the
 *   beans that landed meanwhile and touched the bean's files (`sync.noted`).
 *
 * `overlap` takes the landed beans whose files meet the bean's own (files every bean merges
 * with the union driver, such as CHANGELOG.md, aside) or that the arena declares coupled with
 * it; `all` takes every bean that landed while the agent worked.
 */
import type { Sha, TaskId } from '@beanstalk/shared-race/ids';
import { unionPaths } from '@beanstalk/shared-race/run-config';
import { couplingPartners } from '@beanstalk/shared-race/task';

import type { ReworkOutcome } from '../context';
import { emit, promptTask, requireTask, taskDefinition } from '../context';
import { canResume, createInvocation } from '../invocations';
import type { JobResult } from '../model';
import { syncNote, syncPrompt } from '../prompts';
import type { SyncedBean } from '../prompts';
import { SPROUT_REF } from '../refs';
import { taskWorkspace } from '../tasks';
import { beanAcceptance, carriedPaths } from './v2-amendments';
import { sproutIndex } from './v2-sprout';
import type { LandingFlow, SproutCommit, V2State, V2Step } from './v2-state';

/** The files `union_paths` merges with the union driver: they never conflict or clash. */
const UNION_FILE = /(^|\/)CHANGELOG[^/]*\.md$/;

type Squash = Extract<JobResult, { kind: 'squash' }>;

/** A landed bean as the sync names it. */
type MetBean = SyncedBean & { readonly task: TaskId };

/** Whether the run syncs live (`overlap` or `all`). */
export function isLiveSync(state: V2State): boolean {
  return (state.settings.liveSync ?? 'off') !== 'off';
}

/**
 * The bean's agent finished an invocation: when something landed meanwhile, keep the agent
 * until the squash says whether it gets a sync turn. Returns whether the agent is kept.
 */
export function holdForSync(step: V2Step, flow: LandingFlow): boolean {
  if (flow.syncDue !== true) return false;
  if (landedMeanwhile(step, flow.task).length > 0) return true;
  flow.syncDue = false;
  return false;
}

/**
 * The squash after an invocation returned: start the sync turn (true: it took the bean over),
 * or note a conflict for the next prompt and let the landing go on (false).
 */
export function syncAtBoundary(
  step: V2Step,
  flow: LandingFlow,
  squash: { readonly head0: Sha; readonly result: Squash },
): boolean {
  if (flow.syncDue !== true) return false;
  flow.syncDue = false;
  const { head0, result } = squash;
  const touched = result.outcome === 'conflict' ? result.files : (result.changeFiles ?? []);
  const beans = meetingBeans(step, flow.task, touched);
  if (beans.length === 0) return false;
  if (result.outcome === 'conflict') {
    noteConflict(step, flow, { head0, beans, conflicts: result.files });
    return false;
  }
  startSync(step, flow, { head0, beans });
  return true;
}

/** The sync turn reported: log what it took in, then the bean's landing loop goes on. */
export function onSyncDone(step: V2Step, outcome: ReworkOutcome): void {
  const flow = step.state.landings[outcome.task];
  if (flow?.step.kind !== 'syncing') return;
  if (outcome.committed) {
    step.state.stats.syncs_applied += 1;
    emit(step.ctx, 'sync.applied', {
      task: flow.task,
      sprout: flow.step.head0,
      landed: [...flow.step.landed],
      files: [...outcome.files],
      inv: outcome.inv,
    });
  }
  step.flow.attempt(flow.task);
}

/** The note a conflict left for the bean's next prompt (taken once), or ''. */
export function takeSyncNote(flow: LandingFlow): string {
  const note = flow.syncNote ?? '';
  delete flow.syncNote;
  return note;
}

function startSync(
  step: V2Step,
  flow: LandingFlow,
  sync: { readonly head0: Sha; readonly beans: readonly MetBean[] },
): void {
  const { ctx } = step;
  const task = requireTask(ctx, flow.task);
  const definition = promptTask(ctx, flow.task);
  const resumed = canResume(ctx, task);
  flow.step = { kind: 'syncing', head0: sync.head0, landed: sync.beans.map((bean) => bean.task) };
  createInvocation(ctx, {
    kind: 'sync',
    task: flow.task,
    slot: flow.slot,
    attempt: flow.rounds + 1,
    prompt: syncPrompt(definition, sync.beans, resumed),
    freshPrompt: syncPrompt(definition, sync.beans, false),
    resume: resumed ? task.sessionId : null,
    workspace: (inv) =>
      taskWorkspace(ctx, task, {
        kind: 'sync',
        inv,
        merge: { sha: sync.head0, ref: SPROUT_REF, conflicts: [] },
        acceptance: beanAcceptance(step, flow.task),
        unprotect: carriedPaths(step, flow.task),
      }),
    replay: { reset_to: null, check: null, fixes: [] },
  });
}

function noteConflict(
  step: V2Step,
  flow: LandingFlow,
  sync: {
    readonly head0: Sha;
    readonly beans: readonly MetBean[];
    readonly conflicts: readonly string[];
  },
): void {
  step.state.stats.syncs_noted += 1;
  flow.syncNote = syncNote(sync.beans);
  emit(step.ctx, 'sync.noted', {
    task: flow.task,
    sprout: sync.head0,
    landed: sync.beans.map((bean) => bean.task),
    files: [...new Set(sync.beans.flatMap((bean) => bean.files))].toSorted(),
    conflicts: [...sync.conflicts],
  });
}

/** Other beans that landed on the sprout since the bean last merged it, and still stand. */
function landedMeanwhile(step: V2Step, task: TaskId): SproutCommit[] {
  const { state } = step;
  const since = sproutIndex(state, requireTask(step.ctx, task).mergedMain);
  return state.commits
    .slice(since + 1)
    .filter(
      (commit) =>
        commit.kind === 'task' && commit.task !== null && commit.task !== task && !commit.reverted,
    );
}

/** The beans that landed meanwhile and meet `touched` (`overlap`), or all of them (`all`). */
function meetingBeans(step: V2Step, task: TaskId, touched: readonly string[]): MetBean[] {
  const { ctx, state } = step;
  const hasUnion = unionPaths(ctx.env.config).length > 0;
  const isShared = (path: string): boolean => hasUnion && UNION_FILE.test(path);
  const mine = new Set(touched.filter((path) => !isShared(path)));
  const partners = new Set(couplingPartners(taskDefinition(ctx, task)));
  const beans: MetBean[] = [];
  for (const commit of landedMeanwhile(step, task)) {
    const landedTask = commit.task;
    if (landedTask === null) continue;
    const shared = commit.files.filter((path) => mine.has(path));
    const isPartner =
      partners.has(landedTask) || couplingPartners(taskDefinition(ctx, landedTask)).includes(task);
    const meets = shared.length > 0 || isPartner;
    if (state.settings.liveSync === 'overlap' && !meets) continue;
    beans.push({
      task: landedTask,
      title: taskDefinition(ctx, landedTask).title,
      files: shared.length > 0 ? shared : commit.files.filter((path) => !isShared(path)),
    });
  }
  return beans;
}
