import type { SlotId } from '@gitstalk/shared-race/ids';

import type { StepContext } from './context';
import { refreshSlotClocks } from './context';
import type { SlotState } from './model';

/**
 * The first slot (in id order) with no work that is asking for work right now. The
 * harness's `free_agent()` only checks for work; a cloud slot must also have an open
 * long poll, so a slot whose driver is not running never receives a task.
 */
export function freeAskingSlot(ctx: StepContext): SlotState | undefined {
  return ctx.state.slots.find(
    (slot) =>
      slot.holding === null &&
      slot.running === null &&
      slot.outbox === null &&
      slot.pollId !== null,
  );
}

/** Binds work (a task or ticket id) to a slot (`Race.hold`). */
export function hold(ctx: StepContext, slot: SlotState, work: string): void {
  slot.holding = work;
  refreshSlotClocks(ctx);
}

/** Frees a slot from whatever it holds (`Race.release`). */
export function release(ctx: StepContext, slotId: SlotId | null): void {
  for (const slot of ctx.state.slots) {
    if (slot.id === slotId) slot.holding = null;
  }
  refreshSlotClocks(ctx);
}

/** The slot bound to a piece of work, if any. */
export function holderOf(ctx: StepContext, work: string): SlotState | undefined {
  return ctx.state.slots.find((slot) => slot.holding === work);
}

/** Closes every slot's clock at the end of the race (`close_agent_clock`). */
export function closeSlotClocks(ctx: StepContext): void {
  for (const slot of ctx.state.slots) {
    slot.totals[slot.state] += ctx.now - slot.since;
    slot.since = ctx.now;
  }
}
