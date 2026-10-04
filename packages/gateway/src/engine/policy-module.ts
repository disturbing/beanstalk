import type { Json } from '@beanstalk/shared-race/events';
import type { PolicyView } from '@beanstalk/shared-race/rpc';
import type { PolicyName } from '@beanstalk/shared-race/run-config';

import type { PolicyHooks, StepContext } from './context';

/** A policy's lines in `summary.json`: its own stats block plus rows for `summary.md`. */
export type PolicySummary = {
  readonly key: string;
  readonly stats: Readonly<Record<string, Json>>;
  readonly rows: readonly (readonly [string, Json])[];
};

/**
 * An integration policy. The core runs tasks, invocations, CI and the final check; a
 * policy decides who works on what, when changes land and how failures are repaired.
 * `queue` (the baseline) and `beanstalk-v2` (the product, `v2/`) implement it.
 */
export type PolicyModule<S> = {
  readonly name: PolicyName;
  /** The policy's state at race start; the sprout and the stalk are at `ctx.state.baseSha`. */
  init(ctx: StepContext): S;
  /** Hooks bound to this step's context and the policy's draft state. */
  hooks(ctx: StepContext, state: S): PolicyHooks;
  /** The policy's summary block; `nowSeconds` closes anything still open (`self.now()`). */
  summary(state: S, nowSeconds: number): PolicySummary;
  /** What the live page and the web app show about the policy (queue depth, batches, tickets …). */
  view(state: S): PolicyView;
};
