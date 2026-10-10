import type { PolicyView } from '@gitstalk/shared-race/rpc';

import type { PolicyHooks, StepContext } from './context';
import { EngineInvariantError, assertNever } from './errors';
import type { PolicySummary } from './policy-module';
import { queuePolicy } from './queue/queue-policy';
import type { PolicyState } from './state';
import { v2Policy } from './v2/v2-policy';

/**
 * The policy registry: the only place that knows every policy. A new policy is a module
 * beside `queue/` and `v2/`, a variant of `PolicyState`, and a case in each switch below.
 */
export function createPolicyState(ctx: StepContext): PolicyState {
  const name = ctx.env.config.policy;
  if (name === 'queue') return queuePolicy.init(ctx);
  if (name === 'beanstalk-v2') return v2Policy.init(ctx);
  throw new EngineInvariantError(`policy ${name} is not implemented`);
}

/** Binds the running policy's hooks to this step (null before the race starts). */
export function bindPolicy(ctx: StepContext): PolicyHooks | null {
  const state = ctx.state.policy;
  if (state === null) return null;
  switch (state.kind) {
    case 'queue':
      return queuePolicy.hooks(ctx, state);
    case 'beanstalk-v2':
      return v2Policy.hooks(ctx, state);
    default:
      return assertNever(state);
  }
}

export function summarizePolicy(state: PolicyState, nowSeconds: number): PolicySummary {
  switch (state.kind) {
    case 'queue':
      return queuePolicy.summary(state, nowSeconds);
    case 'beanstalk-v2':
      return v2Policy.summary(state, nowSeconds);
    default:
      return assertNever(state);
  }
}

export function viewPolicy(state: PolicyState): PolicyView {
  switch (state.kind) {
    case 'queue':
      return queuePolicy.view(state);
    case 'beanstalk-v2':
      return v2Policy.view(state);
    default:
      return assertNever(state);
  }
}
