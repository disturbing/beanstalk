/**
 * Spec amendments (v2.2, E6 §2.2). An accepted amendment replaces the loser's acceptance
 * tests (`amendedTests`). An in-place amendment of a landed loser travels with the winner
 * (it merges the author's commit and keeps the files like its own tests) and becomes the
 * loser's spec when the winner lands; if the winner is dropped, it is rolled back.
 */
import type { TaskId } from '@gitstalk/shared-race/ids';

import { acceptanceTests, emit } from '../context';
import type { CarriedAmendment, V2State, V2Step } from './v2-state';

/** Replaces some of a task's acceptance tests with amended contents. */
export function amend(step: V2Step, task: TaskId, files: Readonly<Record<string, string>>): void {
  const current = step.ctx.state.amendedTests[task] ?? {};
  step.ctx.state.amendedTests[task] = { ...current, ...files };
}

/** The tests a bean's commits keep: its own (amended) ones and the amendments it carries. */
export function beanAcceptance(step: V2Step, task: TaskId): Readonly<Record<string, string>> {
  const carried = step.state.carried[task] ?? [];
  const own = acceptanceTests(step.ctx, task);
  if (carried.length === 0) return own;
  return Object.assign({}, own, ...carried.map((amendment) => amendment.files));
}

/** Landed tests a bean carries amendments of: the driver must not restore them. */
export function carriedPaths(step: V2Step, task: TaskId): string[] {
  return (step.state.carried[task] ?? []).flatMap((amendment) => Object.keys(amendment.files));
}

/** A winner starts carrying an in-place amendment of a landed loser. */
export function carry(state: V2State, winner: TaskId, amendment: CarriedAmendment): void {
  state.carried[winner] = [...(state.carried[winner] ?? []), amendment];
}

/** The winner landed: the amendments it carried are the losers' specs from now on. */
export function settleCarried(step: V2Step, winner: TaskId): void {
  for (const amendment of step.state.carried[winner] ?? []) {
    amend(step, amendment.loser, amendment.files);
  }
}

/**
 * The winner was dropped (before or after landing): its in-place amendments are undone,
 * and each loser's tests are what they were before the card.
 */
export function rollBack(step: V2Step, winner: TaskId): void {
  const carried = step.state.carried[winner];
  if (carried === undefined) return;
  delete step.state.carried[winner];
  for (const amendment of carried) {
    const amended = step.ctx.state.amendedTests[amendment.loser];
    if (amended !== undefined) {
      for (const path of Object.keys(amendment.files)) {
        const before = amendment.before[path];
        if (before === undefined) delete amended[path];
        else amended[path] = before;
      }
    }
    step.state.stats.amendments_rolled_back += 1;
    emit(step.ctx, 'spec.amended', {
      card: amendment.card,
      task: amendment.loser,
      status: 'rolled-back',
      paths: Object.keys(amendment.files).toSorted(),
      in_place: true,
      fail_first: null,
      problems: [`${winner}, which carried the amendment, was dropped`],
      inv: null,
    });
  }
}
