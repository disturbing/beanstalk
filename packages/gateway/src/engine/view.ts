import type { FinalView, RunView, TaskCounts } from '@beanstalk/shared-race/rpc';

import type { EngineEnv } from './catalog';
import { finalCheckFields } from './final-check';
import { committedCost } from './invocations';
import type { TaskState, TaskStatus } from './model';
import { roundTo } from './numbers';
import { viewPolicy } from './policy';
import type { EngineState } from './state';

/** The run at a glance (`RunView` without the run id and repo, which the RunDO adds). */
export function runView(state: EngineState, env: EngineEnv): Omit<RunView, 'run' | 'repo'> {
  const config = env.config;
  const tasks = Object.values(state.tasks);
  return {
    phase: state.phase,
    aborted: state.aborted,
    policy: config.policy,
    agent: config.agent,
    model: config.model,
    created_at: new Date(state.createdAtMs).toISOString(),
    t: roundTo(state.clock, 3),
    race_t0: state.raceT0,
    base_sha: state.baseSha,
    events: state.seq,
    tasks: taskCounts(tasks),
    task_status: Object.fromEntries(
      state.order.map((id) => [id, state.tasks[id]?.status ?? 'pending']),
    ),
    slots: state.slots.map((slot) => ({
      slot: slot.id,
      activity: slot.state,
      holding: slot.holding,
      invocation: slot.running ?? slot.outbox,
      asking: slot.pollId !== null,
    })),
    cost: {
      spent_usd: roundTo(state.spent, 4),
      committed_usd: roundTo(committedCost(state), 4),
      budget_usd: config.budget_usd,
    },
    ci: {
      slots: config.ci_slots,
      claimed: state.ci.claimed,
      queued: state.ci.queue.length,
      running: Object.values(state.ci.runs).map((run) => ({
        ci: run.id,
        purpose: run.purpose,
        sha: run.sha,
        slot: run.slot,
        status: run.status,
      })),
    },
    policy_state: state.policy === null ? null : viewPolicy(state.policy),
    final: finalView(state),
  };
}

/** Tasks per status, every status present. */
export function taskCounts(tasks: readonly TaskState[]): TaskCounts {
  const counts: Record<TaskStatus, number> = {
    pending: 0,
    running: 0,
    queued: 0,
    testing: 0,
    rework: 0,
    landed: 0,
    green: 0,
    dropped: 0,
    parked: 0,
  };
  for (const task of tasks) counts[task.status] += 1;
  return counts;
}

function finalView(state: EngineState): FinalView | null {
  if (state.final === null) return null;
  if (state.final.phase !== 'done') return { phase: state.final.phase };
  return { phase: 'done', ...finalCheckFields(state.final.report) };
}
