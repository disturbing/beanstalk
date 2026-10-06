/**
 * v2.5 start cards (E6 `CARD_AFTER_KNOWN=-1`, `COUPLING_PRIOR=arena`). Tasks declare semantic
 * couplings (`couplings`, type `semantic`). When a bean is about to start and a declared
 * partner has already landed, the pair's decision card is raised before any work: the oracle
 * (or a human) decides, the test author amends the loser's tests, and the bean's initial run
 * starts within the decision. E6 raised at most one start card per bean, against the first
 * landed partner not yet decided. Against a declared partner still in flight, the first red
 * check that names it goes to reconcile (or the card) at once, without the usual reds.
 */
import type { Sha, SlotId, TaskId } from '@beanstalk/shared-race/ids';
import { releasesOnCheck } from '@beanstalk/shared-race/run-config';
import { couplingPartners } from '@beanstalk/shared-race/task';

import { emit, requireTask, taskDefinition } from '../context';
import { createInvocation } from '../invocations';
import type { Seconds, SlotState } from '../model';
import { startDecisionPrompt } from '../prompts';
import { release } from '../slots';
import { taskBranch, taskWorkspace } from '../tasks';
import { beanAcceptance, carriedPaths } from './v2-amendments';
import { decisionOf, isDecided, requireCard, scheduleAnswer } from './v2-decisions';
import { sproutIndex } from './v2-sprout';
import type { DecisionCard, LandingFlow, V2State, V2Step } from './v2-state';

/** Red checks against a declared partner that raise its card (E6: the first one). */
const CARD_AFTER_PARTNER_REDS = 1;

/** Declared semantic partners of a task, whichever side declared the coupling. */
export function declaredPartners(step: V2Step, task: TaskId): TaskId[] {
  const { ctx } = step;
  const own = couplingPartners(taskDefinition(ctx, task), 'semantic');
  const theirs = ctx.state.order.filter((other) =>
    couplingPartners(taskDefinition(ctx, other), 'semantic').includes(task),
  );
  return [...new Set([...own, ...theirs])].filter(
    (other) => other !== task && ctx.state.tasks[other] !== undefined,
  );
}

/** Red checks against `culprit` after which the pair goes to reconcile or a card. */
export function cardAfterReds(step: V2Step, task: TaskId, culprit: TaskId, usual: number): number {
  if (!step.ctx.env.config.start_cards) return usual;
  return declaredPartners(step, task).includes(culprit) ? CARD_AFTER_PARTNER_REDS : usual;
}

/**
 * E6 `partner_rechecks`: a declared partner landed (or was reverted) on the sprout since the
 * bean's check, so the check says nothing about the pair: check again, even with disjoint files.
 */
export function partnerMovedSince(step: V2Step, task: TaskId, checkedOn: Sha): boolean {
  if (!step.ctx.env.config.start_cards) return false;
  const partners = declaredPartners(step, task);
  if (partners.length === 0) return false;
  const { state } = step;
  return state.commits
    .slice(sproutIndex(state, checkedOn) + 1)
    .some((commit) => commit.task !== null && partners.includes(commit.task));
}

/**
 * The bean is about to start on `slot` (which already holds it): raise its start card when a
 * declared partner is on the sprout and the pair is undecided. Returns whether it did; the
 * initial run then waits for the card.
 */
export function openStartCard(step: V2Step, slot: SlotState, id: TaskId): boolean {
  const { ctx, state } = step;
  if (!ctx.env.config.start_cards) return false;
  const landed = declaredPartners(step, id).find(
    (partner) => isOnSprout(step, partner) && !isDecided(state, id, partner),
  );
  if (landed === undefined) return false;
  requireTask(ctx, id).agent = slot.id;
  const card = newStartCard(step, id, landed);
  state.cards[card.id] = card;
  state.landings[id] = {
    task: id,
    slot: slot.id,
    rounds: 0,
    rechecks: 0,
    inheritedWaits: 0,
    targeted: 0,
    resolved: 'textual',
    step: { kind: 'decision', card: card.id },
  };
  // The agent waits for no card: with the release, it takes the next task meanwhile.
  if (releasesOnCheck(ctx.env.config)) release(ctx, slot.id);
  scheduleAnswer(step, card);
  return true;
}

/**
 * The start card is decided (and the loser's tests amended): the bean's initial run starts
 * from the sprout head within the decision. A winner merges the test author's in-place
 * amendment of the landed partner's tests, and carries it until it lands.
 */
export function startUnderCard(
  step: V2Step,
  flow: LandingFlow,
  slot: SlotId,
  cardId: string,
): void {
  const { ctx, state } = step;
  const card = requireCard(state, cardId);
  const task = requireTask(ctx, flow.task);
  // The landing flow starts again with the initial commit (`startLanding`).
  delete state.landings[flow.task];
  const base = state.sprout;
  task.status = 'running';
  task.baseSha = base;
  task.mergedMain = base;
  task.headSha = null;
  task.startedAt ??= ctx.now;
  emit(ctx, 'task.start', { task: flow.task, agent: slot, base, predicted: task.selected });
  const isWinner = card.winner === flow.task;
  const authorHead = isWinner ? (card.amendment?.head ?? null) : null;
  const loser = card.loser;
  const prompt = startDecisionPrompt(taskDefinition(ctx, flow.task), decisionOf(card), {
    winner: isWinner ? null : card.winnerContext,
    isWinner,
    amended: isWinner ? [] : Object.keys(card.amendment?.files ?? {}),
  });
  createInvocation(ctx, {
    kind: 'initial',
    task: flow.task,
    slot,
    attempt: task.infraRetries + 1,
    prompt,
    freshPrompt: prompt,
    resume: null,
    workspace: (inv) =>
      taskWorkspace(ctx, task, {
        kind: 'initial',
        inv,
        merge:
          authorHead === null || loser === null
            ? null
            : { sha: authorHead, ref: `refs/heads/${taskBranch(loser)}`, conflicts: [] },
        acceptance: beanAcceptance(step, flow.task),
        unprotect: carriedPaths(step, flow.task),
      }),
    replay: { reset_to: null, check: null, fixes: [] },
  });
}

/**
 * When the bean's start card opened, for a bean that took a slot and waits for its card (it
 * has no `startedAt` until the card's initial run): the start the stall bound counts from.
 */
export function startCardOpenedAt(state: V2State, id: TaskId): Seconds | undefined {
  return Object.values(state.cards).findLast((card) => card.task === id && card.trigger === 'start')
    ?.openedAt;
}

/** A start card: the arriving bean has no work and no red yet, only its spec. */
function newStartCard(step: V2Step, id: TaskId, landed: TaskId): DecisionCard {
  const { ctx, state } = step;
  state.cardSeq += 1;
  const cardId = `D${String(state.cardSeq).padStart(3, '0')}`;
  const specs = Object.fromEntries(
    [id, landed].map((task) => [task, taskDefinition(ctx, task).title]),
  );
  state.stats.cards += 1;
  state.stats.start_cards += 1;
  emit(ctx, 'decision.request', {
    card: cardId,
    task: id,
    against: [landed],
    specs,
    failing: [],
    attempts: 0,
    trigger: 'start',
  });
  return {
    id: cardId,
    task: id,
    against: [landed],
    specs,
    openedAt: ctx.now,
    status: 'open',
    timerId: null,
    red: { head: state.sprout, failing: [], output: '' },
    winner: null,
    loser: null,
    outcome: null,
    text: null,
    by: null,
    snapshot: null,
    winnerContext: null,
    amendment: null,
    trigger: 'start',
  };
}

/** A landed task that is still on the sprout (not dropped, so not reverted). */
function isOnSprout(step: V2Step, id: TaskId): boolean {
  const task = step.ctx.state.tasks[id];
  return task !== undefined && task.landedSha !== null && task.status !== 'dropped';
}
