/**
 * A bean's landing flow as the other v2 modules see it: look it up, or end it with a drop.
 * Timer keys of the policy live here too, so producers and the router agree on them.
 */
import { TaskId } from '@gitstalk/shared-race/ids';

import { requireTask } from '../context';
import { EngineInvariantError } from '../errors';
import { dropTask, parkTask } from '../tasks';
import { rollBack } from './v2-amendments';
import type { LandingFlow, V2State, V2Step } from './v2-state';

const LATENCY_PREFIX = 'preland:';
const ORACLE_PREFIX = 'decision:';
const FAIL_FIRST_PREFIX = 'failfirst:';
const TESTS_FIRST_PREFIX = 'testsfirst:';

export function requireFlow(state: V2State, task: TaskId): LandingFlow {
  const flow = state.landings[task];
  if (flow === undefined) throw new EngineInvariantError(`${task} has no landing flow`);
  return flow;
}

/**
 * Ends a bean's landing loop by dropping the task (`Race.drop`): its slot is freed, and
 * any in-place amendment it carried is rolled back.
 */
export function endLanding(step: V2Step, task: TaskId, reason: string): void {
  delete step.state.landings[task];
  delete step.state.agentWaitSince[task];
  dropTask(step.ctx, requireTask(step.ctx, task), reason);
  rollBack(step, task);
}

/**
 * Ends a bean's landing loop by parking it (`park`): it needs a person. Its slot is freed and
 * any in-place amendment it carried is rolled back, as for a drop.
 */
export function parkLanding(step: V2Step, task: TaskId, reason: string): void {
  delete step.state.landings[task];
  delete step.state.agentWaitSince[task];
  parkTask(step.ctx, requireTask(step.ctx, task), reason);
  rollBack(step, task);
}

/** Whether the run parks beans that need a person instead of dropping them. */
export function parks(state: V2State): boolean {
  return state.settings.park === true;
}

/** The timer that ends a pre-land check's emulated latency. */
export function latencyTimerKey(task: TaskId): string {
  return `${LATENCY_PREFIX}${task}`;
}

/** The timer that ends a fail-first proof's emulated latency. */
export function failFirstTimerKey(task: TaskId): string {
  return `${FAIL_FIRST_PREFIX}${task}`;
}

/** The timer that ends a tests-first proof's emulated latency (v2.5). */
export function testsFirstTimerKey(task: TaskId): string {
  return `${TESTS_FIRST_PREFIX}${task}`;
}

/** The timer of the oracle that answers a decision card (or takes over from a human). */
export function oracleTimerKey(card: string): string {
  return `${ORACLE_PREFIX}${card}`;
}

export type PolicyTimer =
  | { readonly kind: 'latency'; readonly task: TaskId }
  | { readonly kind: 'fail-first'; readonly task: TaskId }
  | { readonly kind: 'tests-first'; readonly task: TaskId }
  | { readonly kind: 'oracle'; readonly card: string };

/** What a policy timer key names. */
export function parseTimerKey(key: string): PolicyTimer | null {
  if (key.startsWith(LATENCY_PREFIX)) {
    return { kind: 'latency', task: TaskId.parse(key.slice(LATENCY_PREFIX.length)) };
  }
  if (key.startsWith(FAIL_FIRST_PREFIX)) {
    return { kind: 'fail-first', task: TaskId.parse(key.slice(FAIL_FIRST_PREFIX.length)) };
  }
  if (key.startsWith(TESTS_FIRST_PREFIX)) {
    return { kind: 'tests-first', task: TaskId.parse(key.slice(TESTS_FIRST_PREFIX.length)) };
  }
  if (key.startsWith(ORACLE_PREFIX))
    return { kind: 'oracle', card: key.slice(ORACLE_PREFIX.length) };
  return null;
}
