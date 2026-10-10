/**
 * Intake for a continuous engine: a bean that arrived by `git push` becomes a pending task,
 * exactly like an arena task before its start. The policy's dispatch then starts it on a free
 * slot, whose initial invocation the shell answers at once with the pushed commit.
 */
import type { Sha, TaskId } from '@gitstalk/shared-race/ids';

import type { StepContext } from './context';
import { emit, isRacing, taskDefinition } from './context';
import type { EngineResponse } from './model';
import { newTaskState } from './tasks';

/**
 * Admits a pushed bean (its definition is already in the run's tasks). `base` is the sprout
 * commit its head grew from: the bean starts there, so the beans that landed since are the
 * ones its checks can blame (culprits), as for an agent that started from that commit.
 */
export function admitTask(ctx: StepContext, id: TaskId, base: Sha | null): EngineResponse {
  if (!ctx.env.config.continuous) {
    return refused('invalid_state', 'only a continuous engine takes beans by push');
  }
  if (!isRacing(ctx)) return refused('invalid_state', `the engine is ${ctx.state.phase}`);
  if (ctx.state.tasks[id] !== undefined) return refused('invalid_state', `bean ${id} exists`);
  taskDefinition(ctx, id);
  ctx.state.tasks[id] = { ...newTaskState(id, []), pushedBase: base };
  ctx.state.order.push(id);
  ctx.state.policy?.unstarted.push(id);
  emit(ctx, 'footprint.predicted', { task: id, method: 'push', selected: [], probs: {} });
  return { kind: 'accepted' };
}

function refused(code: 'invalid_state', message: string): EngineResponse {
  return { kind: 'refused', refusal: { code, message } };
}
