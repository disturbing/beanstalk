/**
 * Check reuse (`reuse_checks`): a verdict the suite already gave on a tree is not asked for
 * again. A bean that lands on the sprout head it was checked on lands the very commit its full
 * pre-land check passed (`publish` moves the sprout to the checked candidate), so validating
 * that commit on CI runs the same suite on the same tree a second time, on one of only two
 * slots. With reuse on, the validator counts such a commit green from the check
 * (`v2-validator`'s `reuseGreenCheck`), as it promotes the reset commit, whose tree the stalk
 * already has.
 *
 * What makes the key: the commit (its tree, and so every landed test, which v2 protects in the
 * tree), the extra files (none for a pre-land check or a validation) and the suite (the whole
 * suite; a targeted check never counts). The runner does not report tree ids, so the key is
 * the commit sha: a re-squash is a new commit and is never reused, even with an equal tree.
 *
 * Only greens are kept. A red is never reused: a red validation still needs its flake re-run
 * (`flake_confirm`) unless sighted. What reuse gives up is the second, independent run of a
 * green tree: a flaky test that passed the pre-land check is not run again until the next
 * validation of a later head (every later tree contains this one) or the final check.
 */
import type { Sha, TaskId } from '@gitstalk/shared-race/ids';

import type { V2State } from './v2-state';

/** A bean's full pre-land check of `sha` was green: remember it, replacing the bean's older one. */
export function rememberGreenCheck(state: V2State, task: TaskId, sha: Sha): void {
  if (state.settings.reuseChecks !== true) return;
  const checks = (state.greenChecks ??= {});
  for (const [known, owner] of Object.entries(checks)) {
    if (owner === task) delete checks[known];
  }
  checks[sha] = task;
}

/** The bean whose full pre-land check passed exactly this commit, if any (it is then forgotten). */
export function takeGreenCheck(state: V2State, sha: Sha): TaskId | null {
  if (state.settings.reuseChecks !== true) return null;
  const checks = state.greenChecks ?? {};
  const owner = checks[sha];
  if (owner === undefined) return null;
  delete checks[sha];
  return owner;
}
