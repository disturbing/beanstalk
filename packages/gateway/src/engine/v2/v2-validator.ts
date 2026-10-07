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
import { emit, requireTask, setTimer, startJob } from '../context';
import { EngineInvariantError } from '../errors';
import type { CheckResult, JobId, JobResult } from '../model';
import { STALK_REF } from '../refs';
import { onSproutGreen, onSproutRed } from './v2-backpressure';
import { takeGreenCheck } from './v2-check-reuse';
import type { Evidence } from './v2-evidence';
import {
  adoptCheck,
  adoptStalk,
  affectedRun,
  evidenceFor,
  evidenceState,
  isEvidenceOn,
  isStalkUnverified,
  onStalkDemoted,
  onStalkMoved,
  rememberPromoted,
  rememberValidated,
  verifiedIdx,
  vouchedSets,
} from './v2-evidence';
import { cancelValidations, isSproutRewriting } from './v2-reset';
import { awaitOutcome, requireCommit } from './v2-sprout';
import type { AffectedRun, V2State, V2Step } from './v2-state';
import { activeTickets, closeTicket, isInRedEpisode, openTicket } from './v2-tickets';

/** The suite crashed before it reported: the one "file" a ticket can then name. */
const SUITE_CRASHED = '(suite crashed)';
/** The debounce timer's key (no handler: the engine dispatches after every timer). */
export const VALIDATION_DUE_KEY = 'validate-due';
/** A due time within this much of now has come (timer rounding). */
const DUE_SLACK_SECONDS = 0.001;
/** Tests or files an evidence event lists. */
const EVIDENCE_LISTED = 20;

/** An affected validation's tests, the read sets evidence vouched for the rest with, its share. */
type AffectedSuite = Omit<AffectedRun, 'ci'>;

/** Validates the sprout head when it is new and a CI slot is free. */
export function maybeValidate(step: V2Step): void {
  const { ctx, state } = step;
  const headIdx = state.commits.length - 1;
  const isKnown =
    headIdx <= state.greenIdx ||
    state.validating.includes(headIdx) ||
    Object.hasOwn(state.validated, String(headIdx));
  if (isKnown) {
    delete state.validationDue;
    return;
  }
  // No validation, and no reused green, while a reset or revert rewrites the sprout.
  if (isSproutRewriting(state) || reuseGreenCheck(step, headIdx)) return;
  if (promoteOnEvidence(step, headIdx)) return;
  // `repair_landing`: the validation of a bean that repairs a red sprout queues ahead of probes.
  const isRepair = state.commits[headIdx]?.repair === true;
  if (ciAvailable(ctx) <= 0 && !canQueueAhead(step) && !isRepair) return;
  if (!isRepair && isDebounced(step)) return;
  delete state.validationDue;
  state.validating.push(headIdx);
  const affected = affectedTargets(step, headIdx);
  const ciId = requestCi(ctx, {
    sha: requireCommit(state, headIdx).sha,
    purpose: 'validate',
    meta: {
      trunk_idx: headIdx,
      unvalidated: headIdx - state.greenIdx,
      ...(affected === null ? {} : { targeted: true, tests: affected.targets.length }),
    },
    owner: 'policy',
    ...(isRepair ? { ahead: 'bisect' } : validationOrder(step)),
    ...suiteOf(step, affected),
  });
  if (affected !== null) {
    evidenceState(state).affected[String(headIdx)] = { ...affected, ci: ciId };
    state.stats.affected_validations = (state.stats.affected_validations ?? 0) + 1;
  }
  awaitOutcome(state, ciId, { kind: 'validate', idx: headIdx });
}

/**
 * `validation_debounce` (Coop's timing rule): a validation a landing asks for waits
 * min(`validation_debounce_seconds`, time to the next tick), so landings close together share
 * it; one asked for in the step a validation settled starts at once.
 */
function isDebounced(step: V2Step): boolean {
  const { ctx, state } = step;
  const debounce = state.settings.debounce;
  if (debounce === undefined || state.lastSettledAt === ctx.now) return false;
  const due = state.validationDue;
  if (due !== undefined) return ctx.now + DUE_SLACK_SECONDS < due;
  const wait = Math.min(debounce.seconds, debounce.tick - (ctx.now % debounce.tick));
  if (wait <= DUE_SLACK_SECONDS) return false;
  state.validationDue = ctx.now + wait;
  state.stats.debounced = (state.stats.debounced ?? 0) + 1;
  setTimer(ctx, wait, { kind: 'policy', key: VALIDATION_DUE_KEY });
  return true;
}

/**
 * `evidence_promotion`: the newest sprout commit above the stalk with full evidence is promoted
 * without CI. Returns whether the head is now known (promoted).
 */
function promoteOnEvidence(step: V2Step, headIdx: number): boolean {
  const { state } = step;
  if (!isEvidenceOn(state)) return false;
  const evidence = evidenceState(state);
  const key = `${headIdx}:${state.greenIdx}`;
  if (evidence.tried === key) return false;
  for (let idx = headIdx; idx > state.greenIdx; idx -= 1) {
    const proof = evidenceFor(state, idx);
    if (proof.refusal !== null) continue;
    promoteByEvidence(step, proof, null);
    return idx === headIdx;
  }
  evidence.tried = key;
  return false;
}

/** A commit green on evidence (and, with `run`, its affected tests passing): it becomes the stalk. */
function promoteByEvidence(
  step: V2Step,
  proof: Evidence,
  run: { ci: string; targets: readonly string[]; result: CheckResult | null } | null,
): void {
  const { ctx, state } = step;
  const idx = proof.idx;
  const cancelled = cancelValidations(step, (validated) => validated < idx);
  state.validated[idx] = true;
  state.stats.evidence_promotions = (state.stats.evidence_promotions ?? 0) + 1;
  state.stats.ci_superseded = (state.stats.ci_superseded ?? 0) + cancelled.length;
  emit(ctx, 'promote.evidence', {
    sha: requireCommit(state, idx).sha,
    trunk_idx: idx,
    green_idx: state.greenIdx,
    beans: state.commits
      .slice(state.greenIdx + 1, idx + 1)
      .flatMap((landed) => (landed.kind === 'task' && landed.task !== null ? [landed.task] : [])),
    tests: proof.tests.length,
    checked: [...proof.trees],
    overlaps: proof.overlaps.slice(0, EVIDENCE_LISTED),
    targeted: run === null ? null : { ci: run.ci, tests: [...run.targets] },
    cancelled,
  });
  rememberPromoted(state, idx, { vouched: vouchedSets(proof), run: run?.result ?? null });
  if (idx > state.greenIdx) onSproutGreen(step, idx);
  onGreen(step, idx, 'evidence');
}

/**
 * The tests no evidence vouches for at `idx` (`affected_validation`), when every test of the
 * head is known; null runs the full suite. A refusal is logged either way, so a judge sees why
 * CI ran.
 */
function affectedTargets(step: V2Step, idx: number): AffectedSuite | null {
  const { ctx, state } = step;
  const settings = state.settings.evidence;
  if (settings === undefined) return null;
  const proof = evidenceFor(state, idx);
  state.stats.evidence_refusals = (state.stats.evidence_refusals ?? 0) + 1;
  emit(ctx, 'evidence.refused', {
    sha: requireCommit(state, idx).sha,
    trunk_idx: idx,
    reason: proof.refusal ?? 'affected',
    tests: proof.tests.length,
    affected: proof.affected.slice(0, EVIDENCE_LISTED),
    affected_count: proof.affected.length,
    overlaps: proof.overlaps.slice(0, EVIDENCE_LISTED),
  });
  if (!settings.affectedValidation || proof.refusal !== 'affected') return null;
  return {
    targets: [...proof.affected],
    vouched: vouchedSets(proof),
    share: proof.affected.length / Math.max(1, proof.tests.length),
  };
}

/**
 * What a validation runs: with evidence on, every passing test's read set is asked for; an
 * affected validation runs its targets only, paying the CI overhead and its share of `ci_seconds`.
 */
function suiteOf(
  step: V2Step,
  affected: Pick<AffectedSuite, 'targets' | 'share'> | null,
): Pick<CiRequest, 'only' | 'latency' | 'allReadSets'> {
  const { config } = step.ctx.env;
  if (!isEvidenceOn(step.state)) return {};
  if (affected === null) return { allReadSets: true };
  return {
    allReadSets: true,
    only: affected.targets,
    latency: config.ci_overhead_seconds + config.ci_seconds * affected.share,
  };
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
    settle(step, idx, result, result);
    return;
  }
  state.confirming[idx] = result;
  state.stats.validation_reruns += 1;
  const affected = affectedRun(state, idx) ?? null;
  const ciId = requestCi(ctx, {
    sha: requireCommit(state, idx).sha,
    purpose: 'validate',
    meta: {
      trunk_idx: idx,
      unvalidated: idx - state.greenIdx,
      ...(affected === null ? {} : { targeted: true, tests: affected.targets.length }),
    },
    owner: 'policy',
    ...validationOrder(step),
    ...suiteOf(step, affected),
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
    settle(step, idx, first, null);
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
  settle(step, idx, 'green', rerun);
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
  settle(step, idx, first, null);
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

/**
 * The validation's verdict counts: promote, or open a ticket (`validate`'s tail). `ran` is the
 * green run whose read sets the promoted tree keeps (`evidence_promotion`).
 */
function settle(
  step: V2Step,
  idx: number,
  result: CheckResult | 'green',
  ran: CheckResult | null,
): void {
  const { state } = step;
  state.lastSettledAt = step.ctx.now;
  state.validating = state.validating.filter((validating) => validating !== idx);
  const affected = affectedRun(state, idx);
  if (state.evidence !== undefined) delete state.evidence.affected[String(idx)];
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
    if (affected !== undefined && idx > state.greenIdx) {
      promoteAffected(step, idx, { affected, ran });
      return;
    }
    if (ran?.green === true && idx > state.greenIdx) rememberValidated(state, idx, ran);
    onGreen(step, idx, 'full');
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
 * passed, so it is green without CI: the stalk moves forward to it. Validations of the commits
 * it left behind were cancelled when the reset started; any left stop now.
 */
export function promoteReset(step: V2Step, idx: number): void {
  const { state } = step;
  cancelValidations(step, (validated) => validated < idx);
  state.validated[idx] = true;
  // The reset's tree is the stalk's: fully checked exactly when the stalk was.
  const how = isStalkUnverified(state) ? 'evidence' : 'full';
  adoptStalk(state, idx, state.greenIdx);
  onGreen(step, idx, how);
}

/**
 * An affected validation passed: the tests it ran pass at `idx`, and evidence vouched for the
 * rest when it started, so the commit is promoted on that evidence.
 */
function promoteAffected(
  step: V2Step,
  idx: number,
  green: { affected: AffectedRun; ran: CheckResult | null },
): void {
  const { affected, ran } = green;
  const proof: Evidence = {
    idx,
    tests: [...Object.keys(affected.vouched), ...affected.targets].toSorted(),
    vouched: Object.fromEntries(
      Object.entries(affected.vouched).map(([test, set]) => [test, { voucher: 'affected', set }]),
    ),
    affected: [],
    trees: [],
    overlaps: [],
    refusal: null,
  };
  promoteByEvidence(step, proof, { ci: affected.ci, targets: affected.targets, result: ran });
}

/**
 * `evidence_promotion`: a confirmed red audit of the stalk at `red.idx`. The stalk goes back to
 * the newest commit a full suite passed, the beans promoted since are landed again, and the red
 * settles as a red validation of a commit above the stalk (a ticket, then a reset or revert).
 */
export function demoteStalk(step: V2Step, red: { idx: number; result: CheckResult }): void {
  const { ctx, state } = step;
  const to = verifiedIdx(state);
  const from = state.greenIdx;
  const tasks: string[] = [];
  for (const landed of state.commits.slice(to + 1, from + 1)) {
    delete state.validated[String(landed.idx)];
    if (landed.kind !== 'task' || landed.task === null) continue;
    const task = requireTask(ctx, landed.task);
    if (task.status !== 'green') continue;
    task.status = 'landed';
    task.greenAt = null;
    tasks.push(task.id);
  }
  const base = ctx.state.baseSha;
  if (base === null) throw new EngineInvariantError('v2 demotes onto a base commit');
  state.greenIdx = to;
  state.green = to < 0 ? base : requireCommit(state, to).sha;
  state.stalk.target = state.green;
  pushStalk(step);
  const failing = [...(red.result.failingFiles ?? [])];
  onStalkDemoted(state, to, failing);
  state.stats.audit_reds = (state.stats.audit_reds ?? 0) + 1;
  emit(ctx, 'green.demote', {
    sha: state.green,
    trunk_idx: to,
    from_idx: from,
    audit_sha: requireCommit(state, red.idx).sha,
    audit_idx: red.idx,
    failing,
    tasks,
  });
  settle(step, red.idx, red.result, null);
}

/**
 * `reuse_checks`: the head is the exact commit a bean's full pre-land check passed (it landed
 * on the head it was checked on), so it is green without CI. Validations of older commits can
 * then no longer move the stalk, and stop through the reset's cancellation path (a running
 * suite keeps its slot until the runner returns it). Like a validation, it never happens while
 * a reset or revert rewrites the sprout (`maybeValidate`).
 */
function reuseGreenCheck(step: V2Step, idx: number): boolean {
  const { ctx, state } = step;
  const commit = requireCommit(state, idx);
  if (commit.kind !== 'task' || takeGreenCheck(state, commit.sha) === null) return false;
  const cancelled = cancelValidations(step, (validated) => validated < idx);
  state.validated[idx] = true;
  state.stats.checks_reused = (state.stats.checks_reused ?? 0) + 1;
  state.stats.ci_superseded = (state.stats.ci_superseded ?? 0) + cancelled.length;
  emit(ctx, 'check.reused', {
    sha: commit.sha,
    trunk_idx: idx,
    task: commit.task,
    source: 'preland',
    cancelled,
  });
  if (idx > state.greenIdx) onSproutGreen(step, idx);
  adoptCheck(state, idx, commit.sha);
  onGreen(step, idx, 'full');
  return true;
}

/** `how`: whether a full suite passed the commit's own tree, or evidence vouched for it. */
function onGreen(step: V2Step, idx: number, how: 'full' | 'evidence'): void {
  const { state } = step;
  if (idx > state.greenIdx) promote(step, idx, how);
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
function promote(step: V2Step, idx: number, how: 'full' | 'evidence'): void {
  const { ctx, state } = step;
  const commit = requireCommit(state, idx);
  const previous = state.greenIdx;
  state.greenIdx = idx;
  state.green = commit.sha;
  state.stalk.target = commit.sha;
  onStalkMoved(state, idx, how);
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
