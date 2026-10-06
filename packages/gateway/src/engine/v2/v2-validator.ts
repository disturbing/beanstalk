/**
 * Asynchronous validation (plan §6 step 6; `maybe_validate`, `validate`, `on_validation`
 * and `promote` of `policy_beanstalk.py`): whenever the sprout head is unvalidated and a CI
 * slot is free, the suite runs on it with the emulated CI latency. Green promotes the
 * prefix to the stalk; red opens a repair ticket for the failures no ticket covers yet.
 *
 * v2.2 flake rule (E3, `flake_confirm`): a red that would open a ticket (and so a revert)
 * is first run again on the same commit. Only the same failing test file failing again
 * confirms it; otherwise the test is recorded as flaky and the validation counts as green.
 * v2.3 (`early_tickets`): a bean's inherited pre-land red of the same file on the same
 * sprout commit is the second observation, and confirms the red without the re-run.
 *
 * Every verdict also sizes the sprout window (`v2-backpressure`).
 */
import { markAborted } from '../abort';
import { ciAvailable, hasCiRun, requestCi } from '../ci';
import type { CiRequest } from '../ci';
import { emit, requireTask, startJob } from '../context';
import type { CheckResult, JobId, JobResult } from '../model';
import { STALK_REF } from '../refs';
import { onSproutGreen, onSproutRed } from './v2-backpressure';
import { awaitOutcome, requireCommit } from './v2-sprout';
import type { V2State, V2Step } from './v2-state';
import { activeTickets, closeTicket, isInRedEpisode, openTicket } from './v2-tickets';

/** The suite crashed before it reported: the one "file" a ticket can then name. */
const SUITE_CRASHED = '(suite crashed)';

/** Validates the sprout head when it is new and a CI slot is free. */
export function maybeValidate(step: V2Step): void {
  const { ctx, state } = step;
  const headIdx = state.commits.length - 1;
  const isKnown =
    headIdx <= state.greenIdx ||
    state.validating.includes(headIdx) ||
    Object.hasOwn(state.validated, String(headIdx));
  // `repair_landing`: the validation of a bean that repairs a red sprout queues ahead of probes.
  const isRepair = state.commits[headIdx]?.repair === true;
  if (isKnown || (ciAvailable(ctx) <= 0 && !canQueueAhead(step) && !isRepair)) return;
  state.validating.push(headIdx);
  const ciId = requestCi(ctx, {
    sha: requireCommit(state, headIdx).sha,
    purpose: 'validate',
    meta: { trunk_idx: headIdx, unvalidated: headIdx - state.greenIdx },
    owner: 'policy',
    ...(isRepair ? { ahead: 'bisect' } : validationOrder(step)),
  });
  awaitOutcome(state, ciId, { kind: 'validate', idx: headIdx });
}

/** A validation finished (`validate` after `run_ci`); a red one may be confirmed first. */
export function onValidated(step: V2Step, idx: number, result: CheckResult): void {
  const { ctx, state } = step;
  recordRed(state, idx, result);
  const needsConfirmation =
    !result.green &&
    ctx.env.config.flake_confirm &&
    newFailures(state, idx, result).length > 0 &&
    !isInRedEpisode(state, idx);
  if (!needsConfirmation || isSighted(step, idx, result)) {
    if (needsConfirmation) state.stats.confirmed_by_sighting += 1;
    settle(step, idx, result);
    return;
  }
  state.confirming[idx] = result;
  state.stats.validation_reruns += 1;
  const ciId = requestCi(ctx, {
    sha: requireCommit(state, idx).sha,
    purpose: 'validate',
    meta: { trunk_idx: idx, unvalidated: idx - state.greenIdx },
    owner: 'policy',
    ...validationOrder(step),
  });
  awaitOutcome(state, ciId, { kind: 'confirm', idx });
}

/**
 * The confirming re-run finished. The same failing test file again: the red stands (and
 * revert-first follows). Anything else: a suspected flake, and the validation is green.
 */
export function onConfirmed(step: V2Step, idx: number, rerun: CheckResult): void {
  const { ctx, state } = step;
  const first = state.confirming[idx];
  delete state.confirming[idx];
  if (first === undefined) return;
  recordRed(state, idx, rerun);
  // The re-run is compared with the first run itself: a ticket opened meanwhile may cover
  // the same files, and a red it covers is still red, never a flake.
  const files = first.failingFiles === null ? [] : [...first.failingFiles];
  const isRepeated =
    first.failingFiles === null
      ? rerun.failingFiles === null
      : files.some((path) => rerun.failingFiles?.includes(path) === true);
  if (isRepeated || idx <= state.greenIdx) {
    settle(step, idx, first);
    return;
  }
  for (const path of files) state.flakes[path] = (state.flakes[path] ?? 0) + 1;
  state.stats.flakes_suspected += 1;
  emit(ctx, 'flake.suspected', {
    trunk_idx: idx,
    sha: requireCommit(state, idx).sha,
    failing: first.failingFiles === null ? null : [...first.failingFiles],
    rerun_failing: rerun.failingFiles === null ? null : [...rerun.failingFiles],
    flaky: files,
  });
  settle(step, idx, 'green');
}

/**
 * v2.3: a bean's inherited pre-land red on sprout@idx confirms the red validation of `idx`
 * that waits for its flake re-run; the red settles now (the re-run's result is ignored).
 */
export function confirmBySighting(step: V2Step, idx: number): void {
  const first = step.state.confirming[idx];
  if (first === undefined || !isSighted(step, idx, first)) return;
  delete step.state.confirming[idx];
  step.state.stats.confirmed_by_sighting += 1;
  settle(step, idx, first);
}

/** A bean's inherited pre-land red on sprout@idx saw one of the validation's new failures. */
function isSighted(step: V2Step, idx: number, result: CheckResult): boolean {
  if (!step.ctx.env.config.early_tickets) return false;
  const seen = step.state.sightings[idx] ?? {};
  return newFailures(step.state, idx, result).some((path) => (seen[path]?.length ?? 0) > 0);
}

/** Remembers what failed a validation at `idx`, for `inherited_reds` (`v2-landing`). */
function recordRed(state: V2State, idx: number, result: CheckResult): void {
  if (result.green || result.failingFiles === null || result.failingFiles.length === 0) return;
  const known = state.redValidations[idx] ?? [];
  state.redValidations[idx] = [...new Set([...known, ...result.failingFiles])].toSorted();
}

/** The stalk ref update returned. */
export function onStalkJob(step: V2Step, jobId: JobId, result: JobResult): void {
  const stalk = step.state.stalk;
  const pushing = stalk.inFlight;
  if (pushing?.jobId !== jobId || result.kind !== 'update-ref') return;
  stalk.inFlight = null;
  if (!result.ok && result.actual !== pushing.sha) {
    markAborted(
      step.ctx,
      `the stalk moved unexpectedly: expected ${stalk.pushed}, found ${String(result.actual)}`,
    );
    return;
  }
  stalk.pushed = pushing.sha;
  pushStalk(step);
}

export function isStalkSettled(state: V2State): boolean {
  return state.stalk.inFlight === null && state.stalk.pushed === state.stalk.target;
}

/** The validation's verdict counts: promote, or open a ticket (`validate`'s tail). */
function settle(step: V2Step, idx: number, result: CheckResult | 'green'): void {
  const { state } = step;
  state.validating = state.validating.filter((validating) => validating !== idx);
  const isGreen = result === 'green' || result.green;
  const isEpisode = !isGreen && isInRedEpisode(state, idx);
  if (idx > state.greenIdx) {
    // One red episode halves the window once: a red whose failures a ticket already covers
    // is the same episode seen again.
    if (isGreen) onSproutGreen(step, idx);
    else if (newFailures(state, idx, result).length > 0 && !isEpisode) onSproutRed(step, idx);
  }
  state.validated[idx] = isGreen;
  state.stats.validations += 1;
  if (result === 'green' || result.green) {
    state.stats.validations_green += 1;
    onGreen(step, idx);
    return;
  }
  state.stats.validations_red += 1;
  if (isEpisode) {
    state.stats.episode_reds = (state.stats.episode_reds ?? 0) + 1;
    return;
  }
  onRed(step, idx, result);
}

/**
 * `red_reset`: the reset commit at `idx` has the tree of the stalk, which a validation already
 * passed, so it is green without CI: the stalk moves forward to it.
 */
export function promoteReset(step: V2Step, idx: number): void {
  step.state.validated[idx] = true;
  onGreen(step, idx);
}

function onGreen(step: V2Step, idx: number): void {
  const { state } = step;
  if (idx > state.greenIdx) promote(step, idx);
  for (const ticket of activeTickets(state)) {
    if (ticket.redIdx <= idx && ticket.status !== 'bisecting') {
      closeTicket(step, ticket, `green at trunk #${idx}`);
    }
  }
}

/** `on_validation` for a red head: new failures (not covered by a ticket or a pending revert). */
function onRed(step: V2Step, idx: number, result: CheckResult): void {
  const { state } = step;
  if (idx <= state.greenIdx) {
    state.stats.stale_reds += 1;
    return;
  }
  const files = newFailures(state, idx, result);
  if (files.length > 0) openTicket(step, { idx, result, files });
}

/** Failing files at `idx` that no active ticket or pending revert covers yet. */
export function newFailures(state: V2State, idx: number, result: CheckResult): string[] {
  if (idx <= state.greenIdx) return [];
  const active = activeTickets(state);
  if (result.failingFiles === null) return active.length > 0 ? [] : [SUITE_CRASHED];
  const covered = new Set(active.flatMap((ticket) => ticket.failingFiles));
  for (const ticket of Object.values(state.tickets)) {
    const isPendingRevert = ticket.status === 'reverted' && (ticket.revertIdx ?? -1) > idx;
    if (isPendingRevert) for (const path of ticket.failingFiles) covered.add(path);
  }
  return [...new Set(result.failingFiles)].filter((path) => !covered.has(path)).toSorted();
}

/** `promote`: the stalk moves to `idx`; the beans up to it are green. */
function promote(step: V2Step, idx: number): void {
  const { ctx, state } = step;
  const commit = requireCommit(state, idx);
  const previous = state.greenIdx;
  state.greenIdx = idx;
  state.green = commit.sha;
  state.stalk.target = commit.sha;
  pushStalk(step);
  const promoted: string[] = [];
  for (const landed of state.commits.slice(previous + 1, idx + 1)) {
    if (landed.kind !== 'task' || landed.task === null || landed.reverted) continue;
    const task = requireTask(ctx, landed.task);
    if (task.status !== 'landed') continue;
    task.status = 'green';
    task.greenAt = ctx.now;
    promoted.push(task.id);
  }
  emit(ctx, 'green.promote', { sha: commit.sha, trunk_idx: idx, tasks: promoted });
}

/** Moves the stalk ref towards the newest validated commit, one lease at a time. */
function pushStalk(step: V2Step): void {
  const stalk = step.state.stalk;
  if (stalk.inFlight !== null || stalk.pushed === stalk.target) return;
  const jobId = startJob(
    step.ctx,
    { kind: 'update-ref', ref: STALK_REF, newSha: stalk.target, oldSha: stalk.pushed },
    { kind: 'policy' },
  );
  awaitOutcome(step.state, jobId, { kind: 'stalk' });
  stalk.inFlight = { jobId, sha: stalk.target };
}

/** `validation_first`: validations go ahead of waiting bisect probes on the CI slots. */
function validationOrder(step: V2Step): Pick<CiRequest, 'ahead'> {
  return step.ctx.env.config.validation_first ? { ahead: 'bisect' } : {};
}

/**
 * `validation_first`: with every slot taken while a bisection runs, one validation still
 * queues, ahead of the probes, and takes the next free slot.
 */
function canQueueAhead(step: V2Step): boolean {
  const { ctx } = step;
  return (
    ctx.env.config.validation_first &&
    hasCiRun(ctx, 'bisect') &&
    !hasCiRun(ctx, 'validate', 'queued')
  );
}
