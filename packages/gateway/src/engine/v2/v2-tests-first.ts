/**
 * v2.5 tests first (E1, `tests_first`). Before a task's implementer starts, a separate test
 * author writes the task's acceptance tests from its intent alone: a fresh session on the
 * task's slot and base, whose driver keeps only the new test files it created. Each file is
 * then run on the base (fail-first): the files that fail there, and parse, replace the given
 * tests as the task's protected acceptance tests, and the implementer works against them.
 * When no file passes the proof (or the author wrote none, or a job failed), the given tests
 * stay. Either way `tests.first` logs it and the implementer starts.
 */
import type { TaskId } from '@gitstalk/shared-race/ids';
import { prelandSeconds } from '@gitstalk/shared-race/run-config';

import { isRunnableTest } from '../arena';
import { failingTestNames } from '../ci';
import type { ReworkOutcome } from '../context';
import { acceptanceTests, emit, requireTask, setTimer, startJob, taskDefinition } from '../context';
import { EngineInvariantError } from '../errors';
import { createInvocation } from '../invocations';
import type { CheckResult, JobId, JobResult, SlotState } from '../model';
import { testsFirstPrompt } from '../prompts';
import { beginTask, issueInitial, taskWorkspace } from '../tasks';
import { testsFirstTimerKey } from './v2-flows';
import { awaitOutcome } from './v2-sprout';
import type { V2Step } from './v2-state';

/** Emulated latency of a fail-first proof (E1's `PROOF_SECONDS`), capped at the pre-land latency. */
const PROOF_SECONDS = 10;
/** A runner failure message that marks a test file that does not parse. */
const SYNTAX_ERROR = 'SyntaxError';
/** Failing tests listed in `tests.first` (`[:12]`). */
const PROOF_FAILING_TESTS = 12;

type Verdict = {
  readonly inv: string;
  readonly files: readonly string[];
  readonly accepted: Readonly<Record<string, string>>;
  readonly failingTests: readonly string[];
  readonly problems: readonly string[];
};

/** The task starts on `slot` with its test author; its implementer follows the proof. */
export function startTestsFirst(step: V2Step, slot: SlotState, id: TaskId): void {
  const { ctx, state } = step;
  const task = beginTask(ctx, slot, id, state.sprout);
  const prompt = testsFirstPrompt(taskDefinition(ctx, id));
  state.authoring[id] = { kind: 'writing' };
  createInvocation(ctx, {
    kind: 'test-first',
    task: id,
    slot: slot.id,
    attempt: 1,
    prompt,
    freshPrompt: prompt,
    resume: null,
    workspace: (inv) =>
      taskWorkspace(ctx, task, {
        kind: 'test-first',
        inv,
        merge: null,
        head: null,
        acceptance: {},
      }),
    replay: { reset_to: null, check: null, fixes: [] },
  });
}

/** The author finished: read the new test files it committed. */
export function onTestsFirstDone(step: V2Step, outcome: ReworkOutcome): void {
  const { ctx, state } = step;
  const task = requireTask(ctx, outcome.task).id;
  if (state.authoring[task]?.kind !== 'writing') return;
  const others = otherTasksTests(step, task);
  const paths = outcome.committed
    ? outcome.files.filter((path) => isRunnableTest(path) && !others.has(path)).toSorted()
    : [];
  const head = outcome.headSha;
  if (head === null || paths.length === 0) {
    const problem =
      outcome.infraError === null
        ? 'the test author wrote no new test file'
        : `the test author failed: ${outcome.infraError.slice(0, 200)}`;
    settle(step, task, {
      inv: outcome.inv,
      files: [],
      accepted: {},
      failingTests: [],
      problems: [problem],
    });
    return;
  }
  const reads = paths.map((path) => ({ ref: head, path }));
  const jobId = startJob(ctx, { kind: 'read-files', reads }, { kind: 'policy' });
  awaitOutcome(state, jobId, { kind: 'tests-first', task });
  state.authoring[task] = { kind: 'reading', inv: outcome.inv, paths, jobId };
}

/** A read or a proof of a task's test author returned. */
export function onTestsFirstJob(step: V2Step, task: TaskId, jobId: JobId, result: JobResult): void {
  const current = step.state.authoring[task];
  if (current?.kind === 'reading' && current.jobId === jobId && result.kind === 'read-files') {
    prove(step, task, { inv: current.inv, paths: current.paths, contents: result.contents });
    return;
  }
  if (current?.kind === 'proving' && current.jobId === jobId && result.kind === 'check') {
    current.jobId = null;
    current.result = result.check;
    const latency = Math.min(PROOF_SECONDS, prelandSeconds(step.ctx.env.config));
    if (latency > 0) {
      setTimer(step.ctx, latency, { kind: 'policy', key: testsFirstTimerKey(task) });
      return;
    }
    judge(step, task);
  }
}

/** A job of a task's test author failed for good: the given tests stay. */
export function onTestsFirstJobFailed(step: V2Step, task: TaskId, error: string): void {
  const current = step.state.authoring[task];
  if (current === undefined || current.kind === 'writing') return;
  const files = current.kind === 'reading' ? current.paths : Object.keys(current.files);
  settle(step, task, {
    inv: current.inv,
    files,
    accepted: {},
    failingTests: [],
    problems: [error],
  });
}

/** The proof's emulated latency elapsed. */
export function onTestsFirstElapsed(step: V2Step, task: TaskId): void {
  if (step.state.authoring[task]?.kind === 'proving') judge(step, task);
}

/** Acceptance test paths of every other task: an author may not claim them. */
function otherTasksTests(step: V2Step, task: TaskId): Set<string> {
  const { ctx } = step;
  const others = ctx.state.order.filter((id) => id !== task);
  return new Set(others.flatMap((id) => Object.keys(acceptanceTests(ctx, id))));
}

/** Runs the author's files on the task's base, in its slot's sandbox. */
function prove(
  step: V2Step,
  task: TaskId,
  read: { inv: string; paths: readonly string[]; contents: readonly (string | null)[] },
): void {
  const { ctx, state } = step;
  const files: Record<string, string> = {};
  read.paths.forEach((path, index) => {
    const content = read.contents[index];
    if (typeof content === 'string') files[path] = content;
  });
  const { baseSha, agent } = requireTask(ctx, task);
  if (baseSha === null || agent === null) {
    throw new EngineInvariantError(`${task} is authored without a base or a slot`);
  }
  const jobId = startJob(
    ctx,
    { kind: 'check', sha: baseSha, extraFiles: files, instance: { kind: 'sandbox', slot: agent } },
    { kind: 'policy' },
  );
  awaitOutcome(state, jobId, { kind: 'tests-first', task });
  state.authoring[task] = { kind: 'proving', inv: read.inv, files, jobId, result: null };
}

/** Fail-first: a file is accepted when it fails on the base and parses. */
function judge(step: V2Step, task: TaskId): void {
  const current = step.state.authoring[task];
  if (current?.kind !== 'proving' || current.result === null) return;
  const result: CheckResult = current.result;
  const failing = new Set(result.failingFiles ?? []);
  const unparsable = new Set(
    result.failingTests
      .filter((test) => (test.message ?? '').includes(SYNTAX_ERROR))
      .map((test) => test.file),
  );
  const accepted: Record<string, string> = {};
  const problems: string[] = [];
  for (const [path, content] of Object.entries(current.files)) {
    if (unparsable.has(path)) problems.push(`${path}: does not parse`);
    else if (!failing.has(path)) {
      problems.push(`${path}: passes on the base, where the task is not implemented`);
    } else accepted[path] = content;
  }
  const failingTests = failingTestNames(result)
    .filter((name) => Object.hasOwn(current.files, name.split(' > ')[0] ?? ''))
    .slice(0, PROOF_FAILING_TESTS);
  settle(step, task, {
    inv: current.inv,
    files: Object.keys(current.files).toSorted(),
    accepted,
    failingTests,
    problems,
  });
}

/** Logs the verdict, makes accepted files the task's tests, and starts the implementer. */
function settle(step: V2Step, task: TaskId, verdict: Verdict): void {
  const { ctx, state } = step;
  delete state.authoring[task];
  const accepted = Object.keys(verdict.accepted).toSorted();
  const isAccepted = accepted.length > 0;
  if (isAccepted) {
    ctx.state.authoredTests[task] = { ...verdict.accepted };
    state.stats.tests_first_accepted += 1;
  } else {
    state.stats.tests_first_fallbacks += 1;
  }
  const taskState = requireTask(ctx, task);
  emit(ctx, 'tests.first', {
    task,
    status: isAccepted ? 'accepted' : 'fallback',
    base: taskState.baseSha ?? '',
    files: [...verdict.files],
    accepted,
    failing_tests: [...verdict.failingTests],
    problems: [...verdict.problems],
    inv: verdict.inv,
  });
  issueInitial(ctx, taskState);
}
