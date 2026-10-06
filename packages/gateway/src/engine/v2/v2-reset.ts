/**
 * The red-window reset (`red_reset`, the 30-agent post-mortem's fix, `docs/claude-opus/11`).
 * When a red validation's culprit is not one clean lone-suspect revert away, the sprout goes
 * back to the stalk's tree in one new commit (a revert of every commit above the stalk; it
 * never conflicts, and neither the sprout nor the stalk moves backwards). That commit has a
 * tree the stalk already validated, so it is promoted without CI: the sprout is green again at
 * once. The beans of the red window are requeued: each re-runs its pre-land check in its own
 * sandbox on the new sprout and lands again. The culprit is then named by its own red re-check,
 * whose informed rework tells its author the failing tests and what it collided with; beans
 * that build on a requeued bean squash without it (git's merge base keeps only their own
 * change), and a conflict among them goes to the author as any conflict does.
 *
 * The red's read-set suspects among them are requeued one at a time, oldest first, each when
 * the one before it landed or left (green, dropped or parked): requeued together they would
 * check on the same sprout and land the same break again. The other beans are requeued at once. With `requeue_repair` (the
 * burst tail fix) each reset's suspects form a chain of their own, the next goes as soon as the
 * current one has a verdict (landed, left, or red and back with its author), and two suspects
 * of one reset that are red against each other go to reconcile at once (`brokeTogether`).
 *
 * A bean is requeued at most `MAX_REQUEUES` times; a window holding one that was requeued that
 * often is bisected and reverted as before.
 *
 * Guards: once the reset job starts, the validations of the commits it resets are cancelled and
 * no new one starts until it is on the sprout (`isSproutRewriting`), so no green can arrive for
 * a tree the reset discards; a reset whose ticket closed, or whose stalk moved meanwhile, is not
 * published, and one already published is not promoted.
 */
import type { Sha, TaskId } from '@beanstalk/shared-race/ids';
import { unionPaths } from '@beanstalk/shared-race/run-config';

import { cancelCi } from '../ci';
import { emit, requireTask, startJob } from '../context';
import type { CiId, JobId } from '../model';
import { resetMessage } from '../prompts';
import { isTerminal, taskBranch } from '../tasks';
import { startProgress } from './v2-bounds';
import { appendCommit, awaitOutcome, takeWait } from './v2-sprout';
import type { LandingFlow, RequeueChain, SproutCommit, V2State, V2Step } from './v2-state';

/** Resets one bean may go through before its windows are bisected again. */
const MAX_REQUEUES = 2;

/** Landed beans above the stalk, oldest first: the red window a reset requeues. */
function windowCommits(state: V2State): SproutCommit[] {
  return state.commits
    .slice(state.greenIdx + 1)
    .filter((commit) => commit.kind === 'task' && !commit.reverted && commit.task !== null);
}

/** Whether a red at the sprout may be repaired by a reset (`red_reset`, within the requeue bound). */
export function canReset(state: V2State): boolean {
  if (state.settings.redReset !== true || state.commits.length - 1 <= state.greenIdx) return false;
  return windowCommits(state).every(
    (commit) => (state.requeues?.[commit.task ?? ''] ?? 0) < MAX_REQUEUES,
  );
}

/**
 * In the turn: the commit that undoes everything above the stalk, on the sprout head. From
 * here on no validation of the commits it resets may move the stalk: they are cancelled.
 */
export function startResetJob(step: V2Step, ticket: string): { head: Sha; to: Sha; jobId: JobId } {
  const { ctx, state } = step;
  const head = state.sprout;
  const to = state.green;
  cancelValidations(step, () => true);
  const jobId = startJob(
    ctx,
    {
      kind: 'revert',
      onto: head,
      commit: head,
      to,
      message: resetMessage(to, head, ticket),
      unionPaths: unionPaths(ctx.env.config),
    },
    { kind: 'policy' },
  );
  awaitOutcome(state, jobId, { kind: 'ticket-revert', ticket });
  return { head, to, jobId };
}

/**
 * Validations whose sprout index `isSuperseded` names stop and free their CI slots: a reset (or,
 * with `red_reset`, a lone suspect's revert) is rewriting the sprout under them, so their verdict
 * can no longer move the stalk (in cf-replay-reset-8-s7 they held both slots, red, after the
 * reset), and so does a `reuse_checks` green above them. A suite already running keeps its slot
 * until the runner returns it. Returns the cancelled runs.
 */
export function cancelValidations(step: V2Step, isSuperseded: (idx: number) => boolean): CiId[] {
  const { ctx, state } = step;
  const cancelled: CiId[] = [];
  for (const run of Object.values(ctx.state.ci.runs)) {
    const wait = state.waits[run.id];
    if (wait?.kind !== 'validate' && wait?.kind !== 'confirm') continue;
    if (!isSuperseded(wait.idx)) continue;
    cancelCi(ctx, run.id, 'until-done');
    takeWait(state, run.id);
    state.validating = state.validating.filter((validating) => validating !== wait.idx);
    delete state.confirming[wait.idx];
    cancelled.push(run.id);
  }
  return cancelled;
}

/**
 * `red_reset`: a ticket's reset, or its revert, is being built or published in the turn. No
 * validation starts meanwhile: the head it would validate is about to be rewritten.
 */
export function isSproutRewriting(state: V2State): boolean {
  if (state.settings.redReset !== true) return false;
  return Object.values(state.reverts).some(
    (flow) =>
      flow.phase === 'reset' ||
      flow.phase === 'reset-publish' ||
      flow.phase === 'revert' ||
      flow.phase === 'publish',
  );
}

/**
 * The reset commit is on the sprout: the window's beans are off it and requeued, and the
 * reset is promoted to the stalk. Returns the reset commit's index.
 */
export function landReset(
  step: V2Step,
  reset: {
    head: Sha;
    sha: Sha;
    /** The stalk the reset took its tree from (absent in states saved before the guard). */
    to?: Sha;
    files: readonly string[];
    ticket: string;
    redIdx: number;
    suspects: readonly TaskId[];
  },
): number {
  const { ctx, state } = step;
  const greenIdx = state.greenIdx;
  const isStale =
    state.greenIdx >= reset.redIdx || (reset.to !== undefined && reset.to !== state.green);
  const window = windowCommits(state);
  const commit = appendCommit(step, {
    sha: reset.sha,
    parent: reset.head,
    kind: 'revert',
    task: null,
    ticket: reset.ticket,
    files: [...reset.files],
    reset: true,
  });
  for (const landed of window) {
    landed.reverted = true;
    landed.revertedAt = commit.idx;
  }
  const requeued = window.flatMap((landed) => (landed.task === null ? [] : [landed.task]));
  state.stats.resets = (state.stats.resets ?? 0) + 1;
  emit(ctx, 'sprout.reset', {
    ticket: reset.ticket,
    red_idx: reset.redIdx,
    green_idx: greenIdx,
    trunk_idx: commit.idx,
    sha: commit.sha,
    requeued,
  });
  if (isStale) {
    // Unreachable while validations are cancelled at the reset's start: a stalk that moved
    // meanwhile is newer than the reset's tree, which must not replace it.
    emit(ctx, 'error', {
      where: 'red_reset',
      error: `the stalk moved while ${reset.ticket} reset the sprout: the reset is not promoted`,
      traceback: '',
    });
  } else {
    step.flow.promoteReset(commit.idx);
  }
  const held: TaskId[] = [];
  for (const landed of window) {
    const id = takeOff(step, landed, reset.ticket);
    if (id === null) continue;
    if (reset.suspects.includes(id)) held.push(id);
    else startAgain(step, id);
  }
  if (held.length > 1 && state.settings.requeueRepair === true) {
    (state.resetSuspects ??= []).push(held);
  }
  holdSuspects(step, { ticket: reset.ticket, held });
  advanceRequeues(step);
  return commit.idx;
}

/**
 * The reset's suspects wait to go back one at a time. With `requeue_repair` each reset has a
 * chain of its own (they run side by side); otherwise every reset's suspects join one.
 */
function holdSuspects(step: V2Step, hold: { ticket: string; held: readonly TaskId[] }): void {
  const chains = requeueChains(step.state);
  const isPerReset = step.state.settings.requeueRepair === true;
  const shared = isPerReset ? undefined : chains[0];
  if (shared === undefined) {
    chains.push({ ticket: hold.ticket, current: null, waiting: [...hold.held] });
    return;
  }
  shared.ticket = hold.ticket;
  shared.waiting.push(...hold.held);
}

/** The requeue chains, taking in the single chain of a state written before there were several. */
function requeueChains(state: V2State): RequeueChain[] {
  const chains = (state.requeueChains ??= []);
  if (state.requeueChain !== undefined) {
    chains.unshift(state.requeueChain);
    delete state.requeueChain;
  }
  return chains;
}

/** Each chain's next held suspect goes back through its check once the one before it is released. */
export function advanceRequeues(step: V2Step): void {
  const { state } = step;
  if (state.requeueChains === undefined && state.requeueChain === undefined) return;
  const chains = requeueChains(state);
  for (const chain of chains) advanceChain(step, chain);
  const live = chains.filter((chain) => chain.current !== null);
  if (live.length > 0) state.requeueChains = live;
  else delete state.requeueChains;
}

function advanceChain(step: V2Step, chain: RequeueChain): void {
  if (chain.current !== null && !isReleased(step, chain.current)) return;
  const next = chain.waiting.shift();
  chain.current = next ?? null;
  if (next !== undefined) startAgain(step, next);
}

/**
 * The chain's current suspect no longer holds the next one back: it landed or left (green,
 * dropped or parked: a parked bean keeps its landing flow for a person's answer, but the chain
 * does not wait for that), or (with `requeue_repair`) its check came back red or conflicted, so
 * it is with its author and its next attempt is checked on a sprout that holds whatever lands
 * meanwhile.
 */
function isReleased(step: V2Step, task: TaskId): boolean {
  const flow = step.state.landings[task];
  if (flow === undefined || isTerminal(requireTask(step.ctx, task))) return true;
  return step.state.settings.requeueRepair === true && flow.rounds > 0;
}

/** A bean of the reset window is off the sprout and requeued (its check comes with `startAgain`). */
function takeOff(step: V2Step, landed: SproutCommit, ticket: string): TaskId | null {
  const { ctx, state } = step;
  const id: TaskId | null = landed.task;
  if (id === null) return null;
  const task = requireTask(ctx, id);
  if (task.status !== 'landed' || task.agent === null) return null;
  task.status = 'running';
  task.landedSha = null;
  task.landedAt = null;
  const requeues = (state.requeues ??= {});
  requeues[id] = (requeues[id] ?? 0) + 1;
  state.stats.requeued = (state.stats.requeued ?? 0) + 1;
  emit(ctx, 'bean.requeued', { task: id, ticket, trunk_idx: landed.idx });
  return id;
}

/**
 * A requeued bean goes back through its pre-land check and lands again. A bean that lost a card
 * had a test author commit on its branch (an adopt-in-place author amends the landed loser's
 * tests there): the branch goes back to the bean's own head first, so its squash carries the
 * bean's change, not the author's commit.
 */
function startAgain(step: V2Step, id: TaskId): void {
  const { ctx, state } = step;
  const task = requireTask(ctx, id);
  if (task.status !== 'running' || task.agent === null) return;
  const flow: LandingFlow = {
    task: id,
    slot: task.agent,
    rounds: 0,
    rechecks: 0,
    inheritedWaits: 0,
    targeted: 0,
    resolved: 'textual',
    step: { kind: 'queued-locked' },
  };
  state.landings[id] = flow;
  startProgress(step, id);
  const authored = task.headSha === null ? null : authoredBranchHead(state, id, task.headSha);
  if (task.headSha !== null && authored !== null) {
    repointBranch(step, flow, { to: task.headSha, from: authored, isRetry: false });
    return;
  }
  step.flow.attempt(id);
}

/**
 * `requeue_repair`: `task` and `culprit` were read-set suspects of one red that reset the
 * sprout. Their pair already broke the sprout once, so a red between them goes to reconcile
 * and a card at once, without an informed rework first.
 */
export function brokeTogether(step: V2Step, task: TaskId, culprit: TaskId): boolean {
  if (step.state.settings.requeueRepair !== true) return false;
  return (step.state.resetSuspects ?? []).some(
    (group) => group.includes(task) && group.includes(culprit),
  );
}

/**
 * Moves `beans/<task>` back to the bean's own head (`to`) under a lease on `from`. The landing
 * flow continues when it returns (`v2-landing`); a lease that finds another commit is retried
 * once from that commit.
 */
export function repointBranch(
  step: V2Step,
  flow: LandingFlow,
  move: { to: Sha; from: Sha; isRetry: boolean },
): void {
  const jobId = startJob(
    step.ctx,
    {
      kind: 'update-ref',
      ref: `refs/heads/${taskBranch(flow.task)}`,
      newSha: move.to,
      oldSha: move.from,
    },
    { kind: 'policy' },
  );
  awaitOutcome(step.state, jobId, { kind: 'landing', task: flow.task });
  flow.step = { kind: 'repoint', to: move.to, isRetry: move.isRetry, jobId };
}

/**
 * Where a card's test author left the bean's branch, when the bean lost a card: the newest
 * author's commit the engine kept, else the bean's own head (an author whose amendment was
 * rejected may still have committed: the lease then finds the commit). Null: no author ever
 * worked on the branch.
 */
function authoredBranchHead(state: V2State, id: TaskId, ownHead: Sha): Sha | null {
  const cards = Object.values(state.cards).filter((card) => card.loser === id);
  if (cards.length === 0) return null;
  const amended = cards.flatMap((card) => {
    const head = card.amendment?.head ?? null;
    return head === null ? [] : [head];
  });
  return amended.at(-1) ?? ownHead;
}
