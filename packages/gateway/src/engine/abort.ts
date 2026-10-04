import type { StepContext } from './context';
import { emit } from './context';

/**
 * Marks the race aborted (`Race.abort`): the first reason wins and is logged once. The
 * engine shuts down at the end of the step, as the harness's main loop does when it wakes.
 */
export function markAborted(ctx: StepContext, reason: string): void {
  if (ctx.state.aborted !== null) return;
  ctx.state.aborted = reason;
  emit(ctx, 'abort', { reason });
}

/** `$12.34 of $25.00`, as the harness formats budget aborts. */
export function budgetMessage(spentUsd: number, budgetUsd: number): string {
  return `budget: $${spentUsd.toFixed(2)} of $${budgetUsd.toFixed(2)}`;
}
