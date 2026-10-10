/**
 * The sprout as the v2 policy records it: every landed bean and revert, in order, with the
 * files it changed. Indexes are the harness's `trunk_idx` (the base is -1).
 */
import type { Sha, TaskId } from '@gitstalk/shared-race/ids';

import { EngineInvariantError } from '../errors';
import type { CiId, JobId } from '../model';
import type { SproutCommit, V2State, V2Step, V2Wait } from './v2-state';

/** The sprout index of a commit, -1 for the base or an unknown sha (`sha_idx.get(x, -1)`). */
export function sproutIndex(state: V2State, sha: Sha | null): number {
  return sha === null ? -1 : (state.shaIdx[sha] ?? -1);
}

/** Appends a commit the sprout now points at and returns it. */
export function appendCommit(
  step: V2Step,
  commit: Omit<SproutCommit, 'idx' | 'landedAt' | 'reverted'>,
): SproutCommit {
  const { state, ctx } = step;
  const landed: SproutCommit = {
    ...commit,
    idx: state.commits.length,
    landedAt: ctx.now,
    reverted: false,
  };
  state.commits.push(landed);
  state.shaIdx[landed.sha] = landed.idx;
  state.sprout = landed.sha;
  return landed;
}

/** Files changed by the commits that landed after `sha` (the delta an optimistic landing tests). */
export function filesLandedSince(state: V2State, sha: Sha): string[] {
  const after = state.commits.slice(sproutIndex(state, sha) + 1);
  return [...new Set(after.flatMap((commit) => commit.files))].toSorted();
}

/** Landed commits not yet covered by a green validation. */
export function unvalidatedCount(state: V2State): number {
  return state.commits.length - 1 - state.greenIdx;
}

/** A task's newest landed commit, reverted or not (`culprit_context`). */
export function lastTaskCommit(state: V2State, task: TaskId): SproutCommit | undefined {
  return state.commits.findLast((commit) => commit.task === task && commit.kind === 'task');
}

/**
 * Files a validation found failing at `head` or below it, back to the last green validation
 * or revert. Not empty: the sprout at `head` is known red (`repair_landing`, `episode_tickets`).
 */
export function knownRedFiles(state: V2State, head: Sha): string[] {
  const files = new Set<string>();
  for (let idx = sproutIndex(state, head); idx > state.greenIdx; idx -= 1) {
    if (state.validated[idx] === true) break;
    for (const path of state.redValidations[idx] ?? []) files.add(path);
    if (state.commits[idx]?.kind === 'revert') break;
  }
  return [...files].toSorted();
}

export function requireCommit(state: V2State, idx: number): SproutCommit {
  const commit = state.commits[idx];
  if (commit === undefined) throw new EngineInvariantError(`no sprout commit ${idx}`);
  return commit;
}

/** Records a revert the sprout now points at, and marks the reverted commit (`revert_culprit`). */
export function landRevert(
  step: V2Step,
  revert: { target: SproutCommit; head: Sha; sha: Sha; files: readonly string[]; ticket: string },
): SproutCommit {
  revert.target.reverted = true;
  step.state.stats.reverts += 1;
  const commit = appendCommit(step, {
    sha: revert.sha,
    parent: revert.head,
    kind: 'revert',
    task: null,
    ticket: revert.ticket,
    files: [...revert.files],
  });
  revert.target.revertedAt = commit.idx;
  return commit;
}

/** Routes a job's or CI run's outcome back to the flow that started it. */
export function awaitOutcome(state: V2State, id: JobId | CiId, wait: V2Wait): void {
  state.waits[id] = wait;
}

/** The flow waiting for a job or CI run, removed from the routing table. */
export function takeWait(state: V2State, id: string): V2Wait | undefined {
  const wait = state.waits[id];
  delete state.waits[id];
  return wait;
}
