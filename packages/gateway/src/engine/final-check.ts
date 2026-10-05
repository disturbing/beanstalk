import type { FinalCheckFields } from '@beanstalk/shared-race/events';
import type { Sha } from '@beanstalk/shared-race/ids';

import { classifyPath } from './arena';
import { requestCi } from './ci';
import type { StepContext } from './context';
import { acceptanceTests, emit, policyHooks, reply, startJob } from './context';
import { EngineInvariantError } from './errors';
import type { CheckResult, CiRun, FinalReport, FinalTaskCheck, TaskState } from './model';

/** Failing files listed in the final report (`sorted(failing)[:50]`). */
const FINAL_FAILING_FILES = 50;

/**
 * `final_check`, step 1: the full suite on the final green commit, without latency.
 * Step 2 adds every task's acceptance tests; step 3 reads committed test files back.
 */
export function startFinalCheck(ctx: StepContext): void {
  const sha = policyHooks(ctx).finalGreenSha();
  const ciId = requestCi(ctx, {
    sha,
    purpose: 'final',
    meta: { check: 'suite' },
    owner: 'final',
    latency: 0,
  });
  ctx.state.final = { phase: 'suite', sha, ciId };
}

/** A final CI run finished: start the next step. */
export function onFinalCi(ctx: StepContext, run: CiRun): void {
  const final = ctx.state.final;
  const result = run.result;
  if (final === null || result === null) return;
  if (final.phase === 'suite' && final.ciId === run.id) {
    if (
      !result.green &&
      final.rerun !== true &&
      policyHooks(ctx).rerunsRedFinalSuite?.() === true
    ) {
      rerunSuite(ctx, final.sha);
      return;
    }
    const ciId = requestCi(ctx, {
      sha: final.sha,
      purpose: 'final',
      meta: { check: 'acceptance' },
      owner: 'final',
      latency: 0,
      extraFiles: allAcceptanceTests(ctx),
    });
    ctx.state.final = { phase: 'acceptance', sha: final.sha, suite: result, ciId };
    return;
  }
  if (final.phase === 'acceptance' && final.ciId === run.id)
    readCommittedFiles(ctx, final.sha, final.suite, result);
}

/**
 * The final suite was red on a commit the policy validated green: the same tree passed the
 * same suite, so it runs once more and the second result counts. Without this, one flaky run
 * in the final check reported a green stalk as wrong (`correct: false`).
 */
function rerunSuite(ctx: StepContext, sha: Sha): void {
  const ciId = requestCi(ctx, {
    sha,
    purpose: 'final',
    meta: { check: 'suite', rerun: true },
    owner: 'final',
    latency: 0,
  });
  ctx.state.final = { phase: 'suite', sha, ciId, rerun: true };
}

/** Every task's acceptance tests, later tasks winning a shared path (`extra.update`). */
function allAcceptanceTests(ctx: StepContext): Record<string, string> {
  const files: Record<string, string> = {};
  for (const id of ctx.state.order) Object.assign(files, acceptanceTests(ctx, id));
  return files;
}

function readCommittedFiles(
  ctx: StepContext,
  sha: Sha,
  suite: CheckResult,
  acceptance: CheckResult,
): void {
  const base = ctx.state.baseSha;
  if (base === null) throw new EngineInvariantError('final check without a base');
  const landedReads = landedTasks(ctx).flatMap((task) =>
    Object.keys(acceptanceTests(ctx, task.id)).map((path) => ({ ref: sha, path })),
  );
  const candidates = changedBaseTestCandidates(ctx);
  const reads = [...landedReads, ...candidates.map((path) => ({ ref: base, path }))];
  const jobId = startJob(ctx, { kind: 'read-files', reads }, { kind: 'final' });
  ctx.state.final = { phase: 'files', sha, suite, acceptance, jobId, candidates };
}

function landedTasks(ctx: StepContext): TaskState[] {
  return ctx.state.order.flatMap((id) => {
    const task = ctx.state.tasks[id];
    return task === undefined || task.landedSha === null ? [] : [task];
  });
}

/**
 * Test files (not acceptance tests) that landed changes touched. The harness diffs base
 * against the final sha; the union of the landed write sets is the same set unless a file
 * was changed and changed back.
 */
function changedBaseTestCandidates(ctx: StepContext): string[] {
  const acceptance = new Set(
    ctx.state.order.flatMap((id) => Object.keys(acceptanceTests(ctx, id))),
  );
  const changed = new Set(landedTasks(ctx).flatMap((task) => task.writeSet));
  return [...changed]
    .filter((path) => !acceptance.has(path) && classifyPath(path) === 'test')
    .toSorted();
}

/** The committed files were read: build the report, log `final.check`, end the run. */
export function onFinalFiles(ctx: StepContext, contents: readonly (string | null)[]): void {
  const final = ctx.state.final;
  if (final?.phase !== 'files') return;
  const intact = new Map<string, boolean>();
  let offset = 0;
  for (const task of landedTasks(ctx)) {
    const expected = Object.values(acceptanceTests(ctx, task.id));
    const actual = contents.slice(offset, offset + expected.length);
    intact.set(
      task.id,
      expected.every((content, index) => actual[index] === content),
    );
    offset += expected.length;
  }
  const baseContents = contents.slice(offset);
  const existedAtBase = (index: number): boolean => typeof baseContents[index] === 'string';
  const report = finalReport(ctx, final.sha, final.suite, final.acceptance, {
    intact,
    baseTestsChanged: final.candidates.filter((_, index) => existedAtBase(index)),
  });
  finishFinalCheck(ctx, report);
}

/** A final step failed for good: the report is the error, as the harness records it. */
export function onFinalError(ctx: StepContext, error: string): void {
  finishFinalCheck(ctx, { error });
}

function finishFinalCheck(ctx: StepContext, report: FinalReport): void {
  emit(ctx, 'final.check', finalCheckFields(report));
  ctx.state.final = { phase: 'done', report };
  finishRun(ctx);
}

/** The report without `per_task`, as `final.check` and `summary.final` carry it. */
export function finalCheckFields(report: FinalReport): FinalCheckFields {
  if ('error' in report) return { error: report.error };
  return {
    sha: report.sha,
    suite_green: report.suite_green,
    suite_tests: report.suite_tests,
    suite_failures: report.suite_failures,
    acceptance_run_green: report.acceptance_run_green,
    tasks_accepted: report.tasks_accepted,
    tasks_total: report.tasks_total,
    green_tasks_accepted: report.green_tasks_accepted,
    green_tasks: report.green_tasks,
    correct: report.correct,
    all_tasks_accepted: report.all_tasks_accepted,
    failing_files: report.failing_files,
    base_tests_changed: report.base_tests_changed,
  };
}

/** The run is over: every open long poll learns it. */
export function finishRun(ctx: StepContext): void {
  ctx.state.phase = 'done';
  for (const slot of ctx.state.slots) {
    if (slot.pollId === null) continue;
    reply(ctx, slot.pollId, { done: true, aborted: ctx.state.aborted });
    slot.pollId = null;
  }
}

type FileFacts = { intact: ReadonlyMap<string, boolean>; baseTestsChanged: string[] };

function finalReport(
  ctx: StepContext,
  sha: Sha,
  suite: CheckResult,
  acceptance: CheckResult,
  facts: FileFacts,
): FinalReport {
  const perTask = perTaskChecks(ctx, acceptance, facts.intact);
  const checks = Object.values(perTask);
  const green = ctx.state.order.filter((id) => ctx.state.tasks[id]?.status === 'green');
  const isAccepted = (id: string): boolean => perTask[id]?.acceptance_pass === true;
  return {
    sha,
    suite_green: suite.green,
    suite_tests: suite.tests,
    suite_failures: suite.failures,
    acceptance_run_green: acceptance.green,
    tasks_accepted: checks.filter((check) => check.acceptance_pass).length,
    tasks_total: ctx.state.order.length,
    green_tasks_accepted: green.filter(isAccepted).length,
    green_tasks: green.length,
    correct: suite.green && green.every(isAccepted),
    all_tasks_accepted: acceptance.green && checks.every((check) => check.acceptance_pass),
    failing_files: [...(acceptance.failingFiles ?? [])].toSorted().slice(0, FINAL_FAILING_FILES),
    base_tests_changed: facts.baseTestsChanged,
    per_task: perTask,
  };
}

/**
 * A task is accepted when all its acceptance files passed and none failed in a run that
 * reported. Without `passing_files` from the runner, "passed" means "ran and did not fail".
 */
function perTaskChecks(
  ctx: StepContext,
  acceptance: CheckResult,
  intact: ReadonlyMap<string, boolean>,
): Record<string, FinalTaskCheck> {
  const failing = new Set(acceptance.failingFiles ?? []);
  const passing = acceptance.passingFiles === null ? null : new Set(acceptance.passingFiles);
  const checks: Record<string, FinalTaskCheck> = {};
  for (const id of ctx.state.order) {
    const task = ctx.state.tasks[id];
    if (task === undefined) continue;
    const paths = Object.keys(acceptanceTests(ctx, id));
    const hasPassed = (path: string): boolean =>
      passing === null ? acceptance.tests > 0 : passing.has(path);
    checks[id] = {
      acceptance_pass:
        paths.length > 0 &&
        acceptance.failingFiles !== null &&
        paths.every((path) => hasPassed(path) && !failing.has(path)),
      status: task.status,
      committed_tests_intact: intact.get(id) ?? true,
    };
  }
  return checks;
}
