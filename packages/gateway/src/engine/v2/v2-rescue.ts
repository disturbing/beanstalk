/**
 * v2.5 rescue (E6 `RESCUE=1`). When a bean's rework rounds run out, it is not dropped at
 * once: it is re-executed once from scratch, on a fresh fork of the sprout head in a fresh
 * session, with the last merged tree's failures and every decision in force on it, and gets a
 * new budget of rounds. Only a second exhaustion drops it. This also catches the loser of a
 * card whose re-execution still fails. E6 shipped t010 this way in two of three runs.
 */
import type { SlotId } from '@gitstalk/shared-race/ids';

import { failingTestNames } from '../ci';
import { emit, promptDefinition, requireTask } from '../context';
import { createInvocation } from '../invocations';
import type { CheckResult } from '../model';
import { rescuePrompt } from '../prompts';
import { taskWorkspace } from '../tasks';
import { requestAgent } from './v2-agents';
import { beanAcceptance, carriedPaths } from './v2-amendments';
import { decisionsInForce } from './v2-decisions';
import type { AgentWork, LandingFlow, V2Step } from './v2-state';

/** Failing tests a rescue's prompt lists (`red.failing_tests[:12]`). */
const RESCUE_FAILING_TESTS = 12;

type RescueWork = Extract<AgentWork, { kind: 'rescue' }>;

/**
 * The bean's rounds ran out on `red` (null: an unresolved conflict). Returns whether it is
 * rescued; when not (the rule is off, or it was rescued before), the caller drops it.
 */
export function rescueOnExhaustion(
  step: V2Step,
  flow: LandingFlow,
  red: CheckResult | null,
): boolean {
  const { ctx, state } = step;
  if (!ctx.env.config.rescue || state.rescued[flow.task] === true) return false;
  state.rescued[flow.task] = true;
  state.stats.rescues += 1;
  emit(ctx, 'rescue.start', {
    task: flow.task,
    why: red === null ? 'unresolved conflict' : 'pre-land check still red',
    rounds: flow.rounds - 1,
  });
  const failing = red === null ? [] : failingTestNames(red).slice(0, RESCUE_FAILING_TESTS);
  requestAgent(step, flow, { kind: 'rescue', failing });
  return true;
}

/** The rescue itself: a fresh session on the sprout head, with a new budget of rounds. */
export function startRescue(step: V2Step, flow: LandingFlow, slot: SlotId, work: RescueWork): void {
  const { ctx, state } = step;
  const task = requireTask(ctx, flow.task);
  const head = state.sprout;
  task.baseSha = head;
  task.mergedMain = head;
  task.headSha = null;
  task.status = 'rework';
  task.reworks += 1;
  flow.rounds = 0;
  flow.rechecks = 0;
  const prompt = rescuePrompt(promptDefinition(ctx, flow.task), {
    failing: work.failing,
    inForce: decisionsInForce(state, flow.task, ''),
    amended: Object.keys(ctx.state.amendedTests[flow.task] ?? {}).toSorted(),
  });
  emit(ctx, 'rework.start', {
    task: flow.task,
    ticket: null,
    reason: 'rescue',
    attempt: 1,
    resumed: false,
  });
  flow.step = { kind: 'rework', reason: 'rescue' };
  createInvocation(ctx, {
    kind: 'rework',
    task: flow.task,
    slot,
    attempt: 1,
    prompt,
    freshPrompt: prompt,
    resume: null,
    workspace: (inv) =>
      taskWorkspace(ctx, task, {
        kind: 'rework',
        inv,
        merge: null,
        base: head,
        head: null,
        acceptance: beanAcceptance(step, flow.task),
        unprotect: carriedPaths(step, flow.task),
      }),
    replay: { reset_to: head, check: 'acceptance', fixes: [] },
  });
}
