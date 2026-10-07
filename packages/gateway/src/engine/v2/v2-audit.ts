/**
 * The background audit of evidence promotion (`evidence_promotion`, `v2-evidence`): the full
 * suite on the stalk, whose tree no full suite has passed since evidence moved it, on a CI slot
 * nothing else is waiting for, once `audit_every` commits were promoted that way, and always
 * before the race ends (so the final check never meets a stalk only evidence vouched for).
 *
 * A green audit makes the stalk's tree verified. A red one is run once more (`flake_confirm`):
 * the same test file failing again confirms it, and then evidence was wrong. The stalk goes back
 * to the newest commit a full suite passed, the beans promoted since are landed again, and the
 * red settles as a red validation of that commit, now above the stalk: a ticket opens and the
 * reset (or a revert) repairs the sprout as for any red. The failing tests are never vouched for
 * again. A red the stalk already moved past with a full suite is stale and ignored.
 */
import { ciAvailable, requestCi } from '../ci';
import { emit } from '../context';
import type { CheckResult } from '../model';
import { evidenceState, isStalkUnverified, rememberValidated } from './v2-evidence';
import { isSproutRewriting } from './v2-reset';
import { awaitOutcome, requireCommit } from './v2-sprout';
import type { AuditRun, V2State, V2Step } from './v2-state';
import { demoteStalk } from './v2-validator';

/** Starts the audit of the stalk when it is owed and a CI slot is idle; settles a held red. */
export function maybeAudit(step: V2Step): void {
  const { ctx, state } = step;
  const settings = state.settings.evidence;
  const evidence = state.evidence;
  if (settings === undefined || evidence === undefined) return;
  if (evidence.audit !== null) {
    settleConfirmedRed(step, evidence.audit);
    return;
  }
  if (!isStalkUnverified(state) || isSproutRewriting(state)) return;
  const isDue = settings.auditEvery > 0 && evidence.unverified.length >= settings.auditEvery;
  if (!isDue && !isWindingDown(state)) return;
  if (ciAvailable(ctx) <= 0 || ctx.state.ci.queue.length > 0) return;
  runAudit(step, state.greenIdx);
  evidence.audit = { idx: state.greenIdx, first: null };
  state.stats.audits = (state.stats.audits ?? 0) + 1;
}

/** An audit's run returned (`confirm`: its re-run after a red). */
export function onAudited(
  step: V2Step,
  run: { idx: number; result: CheckResult; isRerun: boolean },
): void {
  const { ctx, state } = step;
  const audit = state.evidence?.audit;
  if (audit?.idx !== run.idx) return;
  const { result } = run;
  if (result.green) {
    passAudit(state, run.idx, result);
    return;
  }
  if (!run.isRerun && ctx.env.config.flake_confirm) {
    audit.first = result;
    runAudit(step, run.idx, 'confirm');
    return;
  }
  const first = audit.first ?? result;
  if (run.isRerun && !repeats(first, result)) {
    for (const path of first.failingFiles ?? []) state.flakes[path] = (state.flakes[path] ?? 0) + 1;
    state.stats.flakes_suspected += 1;
    emit(ctx, 'flake.suspected', {
      trunk_idx: run.idx,
      sha: requireCommit(state, run.idx).sha,
      failing: first.failingFiles === null ? null : [...first.failingFiles],
      rerun_failing: result.failingFiles === null ? null : [...result.failingFiles],
      flaky: [...(first.failingFiles ?? [])],
    });
    passAudit(state, run.idx, null);
    return;
  }
  audit.confirmed = first;
  settleConfirmedRed(step, audit);
}

/** Whether an audit is running or owed: the race does not end before it is done. */
export function isAuditOwed(state: V2State): boolean {
  return (
    state.evidence !== undefined && (state.evidence.audit !== null || isStalkUnverified(state))
  );
}

function runAudit(step: V2Step, idx: number, kind: 'audit' | 'confirm' = 'audit'): void {
  const { ctx, state } = step;
  const ciId = requestCi(ctx, {
    sha: requireCommit(state, idx).sha,
    purpose: 'validate',
    meta: { trunk_idx: idx, audit: true },
    owner: 'policy',
    allReadSets: true,
  });
  awaitOutcome(state, ciId, { kind: kind === 'audit' ? 'audit' : 'audit-confirm', idx });
}

/** Nothing is left to land: every bean started, none is on its way, the stalk is the head. */
function isWindingDown(state: V2State): boolean {
  return (
    state.unstarted.length === 0 &&
    Object.keys(state.landings).length === 0 &&
    state.greenIdx === state.commits.length - 1
  );
}

/** The stalk at `idx` passed the full suite (`result` keeps its read sets when green). */
function passAudit(state: V2State, idx: number, result: CheckResult | null): void {
  const evidence = evidenceState(state);
  evidence.audit = null;
  if (idx > state.greenIdx || idx <= evidence.verifiedIdx) return;
  evidence.verifiedIdx = idx;
  evidence.unverified = evidence.unverified.filter((promoted) => promoted > idx);
  if (result !== null) rememberValidated(state, idx, result);
}

/**
 * A confirmed red: once no reset or revert is being written, it moves the stalk back.
 */
function settleConfirmedRed(step: V2Step, audit: AuditRun): void {
  const { state } = step;
  const red = audit.confirmed;
  if (red === undefined || isSproutRewriting(state)) return;
  const evidence = evidenceState(state);
  evidence.audit = null;
  // Stale: a full suite passed the stalk at or above it since, or the stalk already went back
  // below it (that demotion's ticket covers the commit).
  if (audit.idx <= evidence.verifiedIdx || audit.idx > state.greenIdx) return;
  demoteStalk(step, { idx: audit.idx, result: red });
}

/** The re-run failed one of the first run's failing files again (or crashed again). */
function repeats(first: CheckResult, rerun: CheckResult): boolean {
  if (first.failingFiles === null) return rerun.failingFiles === null;
  return first.failingFiles.some((path) => rerun.failingFiles?.includes(path) === true);
}
