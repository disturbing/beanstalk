/**
 * Agents for beans (E5; v2.2 `release_on_check`). A bean's agent is freed when the bean is
 * submitted for its pre-land check. Work the bean needs later (a rework, the test author, a
 * re-execution) waits for the next free slot, its last author first, before any new task
 * starts. Without the release, the bean keeps its slot and the work starts there at once.
 */
import type { SlotId } from '@beanstalk/shared-race/ids';
import { releasesOnCheck } from '@beanstalk/shared-race/run-config';

import { requireTask } from '../context';
import type { SlotState } from '../model';
import { freeAskingSlot, hold, holderOf, release } from '../slots';
import type { AgentWork, LandingFlow, V2Step } from './v2-state';

/** The bean was submitted: its agent may take the next task while the bean is checked. */
export function releaseAgent(step: V2Step, flow: LandingFlow): void {
  if (!releasesOnCheck(step.ctx.env.config)) return;
  if (holderOf(step.ctx, flow.task)?.id === flow.slot) release(step.ctx, flow.slot);
}

/**
 * The bean needs an agent for `work`. Without the release, its own slot takes it at once while
 * the slot still holds the bean. A bean that let its slot go meanwhile (requeued by a reset,
 * or taken up again after parking) waits for a free one, as with the release.
 */
export function requestAgent(step: V2Step, flow: LandingFlow, work: AgentWork): void {
  flow.step = { kind: 'awaiting-agent', work };
  const isHeld = holderOf(step.ctx, flow.task)?.id === flow.slot;
  if (!releasesOnCheck(step.ctx.env.config) && isHeld) {
    step.flow.startWork(flow, flow.slot);
    return;
  }
  step.state.agentQueue.push(flow.task);
  step.state.agentWaitSince[flow.task] = step.ctx.now;
  assignAgents(step);
}

/** Hands waiting beans to free slots, oldest first. */
export function assignAgents(step: V2Step): void {
  const { ctx, state } = step;
  while (state.agentQueue.length > 0) {
    const task = state.agentQueue[0];
    const flow = task === undefined ? undefined : state.landings[task];
    if (flow?.step.kind !== 'awaiting-agent') {
      state.agentQueue.shift();
      continue;
    }
    const slot = freeSlot(step, flow.slot) ?? freeAskingSlot(ctx);
    if (slot === undefined) return;
    state.agentQueue.shift();
    recordWait(step, flow);
    hold(ctx, slot, flow.task);
    requireTask(ctx, flow.task).agent = slot.id;
    flow.slot = slot.id;
    step.flow.startWork(flow, slot.id);
  }
}

/** The bean's last author, when it is free and asking for work. */
function freeSlot(step: V2Step, id: SlotId): SlotState | undefined {
  const slot = step.ctx.state.slots.find((candidate) => candidate.id === id);
  const isFree =
    slot !== undefined &&
    slot.holding === null &&
    slot.running === null &&
    slot.outbox === null &&
    slot.pollId !== null;
  return isFree ? slot : undefined;
}

function recordWait(step: V2Step, flow: LandingFlow): void {
  const { state } = step;
  const since = state.agentWaitSince[flow.task];
  delete state.agentWaitSince[flow.task];
  if (since === undefined || step.ctx.now <= since) return;
  state.stats.agent_waits += 1;
  state.stats.agent_wait_seconds += step.ctx.now - since;
}
