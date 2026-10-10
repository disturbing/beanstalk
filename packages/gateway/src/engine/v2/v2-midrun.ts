/**
 * Mid-run live sprout sync (`live_sync_midrun`, opt-in). Boundary sync (`v2-sync`) hands a
 * bean what landed only when its agent's invocation ends, when the pre-land squash makes the
 * same merge anyway. This track syncs while the agent works: each progress report of a
 * running implementer invocation (`initial` or `rework`) may carry back an offer of the beans
 * that landed since the invocation's line and meet its bean (`v2-sync`'s rule over the files
 * the driver reports), with the sprout head. The driver's hook in the agent's session merges
 * it between tool calls when that is safe, or only tells the agent, and the result reports
 * which (`midrun_syncs`). A merge it applied moves the bean's merged line to that sprout.
 */
import type { InvocationResult, MidrunSyncOffer } from '@gitstalk/shared-race/driver';
import { TaskId } from '@gitstalk/shared-race/ids';

import { emit, requireTask } from '../context';
import type { OpenInvocation } from '../model';
import { sproutIndex } from './v2-sprout';
import { landedMeanwhile, meetingBeans } from './v2-sync';
import type { V2Step } from './v2-state';

/** Invocations whose agent writes the bean, so a sync can reach it mid-run. */
const IMPLEMENTER_KINDS: ReadonlySet<string> = new Set(['initial', 'rework']);

/**
 * The offer for a running invocation: the landed beans it has not been offered yet that meet
 * it, with the sprout head; null when there is none or the track is off.
 */
export function midrunOffer(
  step: V2Step,
  inv: OpenInvocation,
  files: readonly string[],
): MidrunSyncOffer | null {
  const { state } = step;
  if (state.settings.liveSyncMidrun !== true || !IMPLEMENTER_KINDS.has(inv.kind)) return null;
  const task = TaskId.parse(inv.task);
  const offered = new Set(state.midrunOffered?.[inv.id] ?? []);
  const fresh = landedMeanwhile(step, task, lineIndex(step, inv)).filter(
    (commit) => commit.task !== null && !offered.has(commit.task),
  );
  if (fresh.length === 0) return null;
  const beans = meetingBeans(step, {
    task,
    touched: files,
    landed: fresh,
    mode: state.settings.liveSync === 'all' ? 'all' : 'overlap',
  });
  if (beans.length === 0) return null;
  const landed = beans.map((bean) => bean.task);
  state.midrunOffered = { ...state.midrunOffered, [inv.id]: [...offered, ...landed] };
  state.stats.midrun_offered = (state.stats.midrun_offered ?? 0) + 1;
  emit(step.ctx, 'sync.midrun.offered', {
    task: inv.task,
    inv: inv.id,
    sprout: state.sprout,
    landed,
    files: distinctFiles(beans),
  });
  return { sprout: state.sprout, landed: beans };
}

/**
 * The invocation ended: log what its agent's hook did with each offer, and when a merge was
 * applied and committed, record the newest such sprout as the bean's merged line.
 */
export function onMidrunSyncs(step: V2Step, inv: OpenInvocation, body: InvocationResult): void {
  const { state } = step;
  if (state.midrunOffered?.[inv.id] === undefined) return;
  const { [inv.id]: _closed, ...open } = state.midrunOffered;
  state.midrunOffered = open;
  for (const sync of body.midrun_syncs ?? []) {
    const fields = { task: inv.task, inv: inv.id, sprout: sync.sprout, landed: [...sync.landed] };
    if (sync.outcome === 'applied') {
      state.stats.midrun_applied = (state.stats.midrun_applied ?? 0) + 1;
      emit(step.ctx, 'sync.midrun.applied', { ...fields, files: [...sync.files] });
    } else {
      state.stats.midrun_noted = (state.stats.midrun_noted ?? 0) + 1;
      emit(step.ctx, 'sync.midrun.noted', {
        ...fields,
        files: [...sync.files],
        reason: sync.reason,
      });
    }
  }
  if (body.head_sha !== null && body.markers_left.length === 0) {
    advanceMergedLine(step, TaskId.parse(inv.task), body);
  }
}

/** The sprout index the invocation's work already contains. */
function lineIndex(step: V2Step, inv: OpenInvocation): number {
  const { state } = step;
  const task = requireTask(step.ctx, inv.task);
  const line = inv.mergedLine ?? inv.workspace.merge?.sha ?? null;
  return Math.max(sproutIndex(state, task.mergedMain), sproutIndex(state, line));
}

function advanceMergedLine(step: V2Step, taskId: TaskId, body: InvocationResult): void {
  const { state } = step;
  const task = requireTask(step.ctx, taskId);
  for (const sync of body.midrun_syncs ?? []) {
    const isNewer = sproutIndex(state, sync.sprout) > sproutIndex(state, task.mergedMain);
    if (sync.outcome === 'applied' && isNewer) task.mergedMain = sync.sprout;
  }
}

function distinctFiles(beans: readonly { readonly files: readonly string[] }[]): string[] {
  return [...new Set(beans.flatMap((bean) => bean.files))].toSorted();
}
