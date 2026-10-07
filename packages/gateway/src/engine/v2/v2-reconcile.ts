/**
 * v2.4: reconcile before a decision card. Two beans' intents often do not contradict: a
 * landed task's test pins a value (an example total) that the arriving bean legitimately
 * changes. Before a card, a test author (a fresh session on the arriving bean's branch, which
 * already merged the landed task) may amend both tasks' acceptance tests so that each intent
 * stays tested. The bean's own amended tests are its spec at once; the landed task's travel
 * with the bean (`v2-amendments`), and are rolled back if it is dropped. The bean then checks
 * again: a green check is the proof. A commit that changes nothing is a contradiction, and
 * only then is the card raised.
 *
 * The author works on the bean's branch with the sprout its red check ran on merged in, so the
 * landed parties' code is in its tree, as the prompt says. An author that fails to run (a crash,
 * a timeout, a lost watchdog) found nothing: it is retried once, and a second failure goes on to
 * an informed repair, leaving the pair unreconciled; it never counts as a contradiction.
 *
 * v2.5 (`reconcile_parties`): a clash often involves more than one landed task (a third task's
 * rule the two tests both pin). The reconcile takes in every landed party behind the failing
 * tests, up to three, and may amend each one's acceptance tests; a contradiction's card names
 * them all.
 */
import type { Sha, SlotId, TaskId } from '@beanstalk/shared-race/ids';
import { releasesOnCheck } from '@beanstalk/shared-race/run-config';

import { failingTestNames } from '../ci';
import type { ReworkOutcome } from '../context';
import { acceptanceTests, emit, promptDefinition, requireTask, startJob } from '../context';
import { createInvocation } from '../invocations';
import type { CheckResult, JobResult } from '../model';
import { reconcilePrompt } from '../prompts';
import { SPROUT_REF } from '../refs';
import { holderOf, release } from '../slots';
import { taskWorkspace } from '../tasks';
import { requestAgent } from './v2-agents';
import { amend, beanAcceptance, carriedPaths, carry } from './v2-amendments';
import { openCard, pairKey } from './v2-decisions';
import { startInformedRepair } from './v2-repair';
import { awaitOutcome } from './v2-sprout';
import type { AgentWork, LandingFlow, LandingStep, V2Step } from './v2-state';

type ReconcileWork = Extract<AgentWork, { kind: 'reconcile' }>;
type Reading = Extract<LandingStep, { kind: 'reconcile-reading' }>;
type Reconciling = Extract<LandingStep, { kind: 'reconciling' }>;

/** Informed repairs name at most this many culprits (`v2-repair`'s `[:2]`). */
const REPAIR_CULPRITS = 2;

/**
 * The test author reconciles the bean's tests with the landed parties', on the bean's branch
 * with the sprout its red check ran on merged in.
 */
export function startReconcile(
  step: V2Step,
  flow: LandingFlow,
  slot: SlotId,
  work: ReconcileWork,
): void {
  const { ctx, state } = step;
  const task = requireTask(ctx, flow.task);
  const parties = [...work.parties];
  const against = partiesTests(step, parties);
  const tests = { ...beanAcceptance(step, flow.task), ...against };
  const failingFiles = new Set(work.red.failingFiles ?? []);
  if (work.retry !== true) state.stats.reconciles += 1;
  flow.step = {
    kind: 'reconciling',
    against: work.against,
    parties,
    red: work.red,
    head: work.head,
    ...(work.retry === true ? { retry: true } : {}),
  };
  const prompt = reconcilePrompt(
    promptDefinition(ctx, flow.task),
    parties.map((party) => promptDefinition(ctx, party)),
    {
      failing: failingTestNames(work.red),
      output: work.red.output,
      tests: Object.fromEntries(Object.entries(tests).filter(([path]) => failingFiles.has(path))),
      paths: Object.keys(tests).toSorted(),
    },
  );
  createInvocation(ctx, {
    kind: 'reconcile',
    task: flow.task,
    slot,
    attempt: 1,
    prompt,
    freshPrompt: prompt,
    resume: null,
    workspace: (inv) =>
      taskWorkspace(ctx, task, {
        kind: 'reconcile',
        inv,
        merge: { sha: work.head, ref: SPROUT_REF, conflicts: [] },
        acceptance: tests,
        unprotect: [...carriedPaths(step, flow.task), ...Object.keys(against)],
      }),
    replay: { reset_to: null, check: null, fixes: [] },
  });
}

/** The test author finished: read every task's tests at its commit. */
export function onReconcileDone(step: V2Step, outcome: ReworkOutcome): void {
  const { ctx, state } = step;
  const flow = state.landings[outcome.task];
  if (flow?.step.kind !== 'reconciling') return;
  if (outcome.infraError !== null) {
    onReconcileFailed(step, flow, { reconciling: flow.step, outcome });
    return;
  }
  if (holderOf(ctx, flow.task)?.id === outcome.slot) release(ctx, outcome.slot);
  const { against, parties, red, head } = flow.step;
  for (const party of parties) state.reconciledPairs[pairKey(flow.task, party)] = true;
  const reason = verdictLine(outcome.resultText);
  const before = { ...beanAcceptance(step, flow.task), ...partiesTests(step, parties) };
  const authored = outcome.headSha;
  if (!outcome.committed || authored === null) {
    contradiction(step, flow, { against, parties, red, head, inv: outcome.inv, reason });
    return;
  }
  const reads = Object.keys(before).map((path) => ({ ref: authored, path }));
  const jobId = startJob(ctx, { kind: 'read-files', reads }, { kind: 'policy' });
  awaitOutcome(state, jobId, { kind: 'landing', task: flow.task });
  flow.step = {
    kind: 'reconcile-reading',
    against,
    parties,
    red,
    head,
    inv: outcome.inv,
    reason,
    before,
    jobId,
  };
}

/**
 * The author failed to run, so it found nothing: retry it once, then repair informed of the
 * parties without reconciling them (a later stuck red may reconcile the pair again).
 */
function onReconcileFailed(
  step: V2Step,
  flow: LandingFlow,
  failed: { reconciling: Reconciling; outcome: ReworkOutcome },
): void {
  const { ctx } = step;
  const { reconciling, outcome } = failed;
  const { against, parties, red, head } = reconciling;
  if (releasesOnCheck(ctx.env.config) && holderOf(ctx, flow.task)?.id === outcome.slot) {
    release(ctx, outcome.slot);
  }
  if (reconciling.retry !== true) {
    emit(ctx, 'invocation.retry', {
      task: flow.task,
      reason: `reconcile failed: ${(outcome.infraError ?? '').slice(0, 200)}`,
    });
    requestAgent(step, flow, { kind: 'reconcile', against, parties, red, head, retry: true });
    return;
  }
  startInformedRepair(step, flow, { head, red, culprits: parties.slice(0, REPAIR_CULPRITS) });
}

/** What the test author changed: reconciled (the tests updated as needed), or a contradiction. */
export function onReconcileRead(
  step: V2Step,
  flow: LandingFlow,
  reading: Reading,
  result: JobResult,
): void {
  const contents = result.kind === 'read-files' ? result.contents : [];
  const changed: Record<string, string> = {};
  Object.keys(reading.before).forEach((path, index) => {
    const content = contents[index];
    if (typeof content === 'string' && content !== reading.before[path]) changed[path] = content;
  });
  if (Object.keys(changed).length === 0) {
    contradiction(step, flow, reading);
    return;
  }
  const { ctx, state } = step;
  const owned = new Set<string>();
  for (const party of reading.parties) {
    const theirs = acceptanceTests(ctx, party);
    const carried = Object.fromEntries(
      Object.entries(changed).filter(([path]) => path in theirs && !owned.has(path)),
    );
    for (const path of Object.keys(theirs)) owned.add(path);
    if (Object.keys(carried).length === 0) continue;
    carry(state, flow.task, {
      card: `reconcile:${reading.inv}`,
      loser: party,
      files: carried,
      before: Object.fromEntries(Object.keys(carried).map((path) => [path, theirs[path] ?? ''])),
      head: reading.head,
    });
  }
  const mine = Object.fromEntries(Object.entries(changed).filter(([path]) => !owned.has(path)));
  if (Object.keys(mine).length > 0) amend(step, flow.task, mine);
  state.stats.reconciled += 1;
  emit(ctx, 'decision.reconcile', {
    task: flow.task,
    against: reading.against,
    outcome: 'reconciled',
    files: Object.keys(changed).toSorted(),
    reason: null,
    inv: reading.inv,
    ...partiesField(reading.parties),
  });
  requireTask(ctx, flow.task).status = 'running';
  step.flow.attempt(flow.task);
}

/** No reconciliation: the genuine disagreement goes to a card, as in v2.3, naming every party. */
function contradiction(
  step: V2Step,
  flow: LandingFlow,
  found: {
    against: TaskId;
    parties: readonly TaskId[];
    red: CheckResult;
    head: Sha;
    inv: string;
    reason: string;
  },
): void {
  step.state.stats.contradictions += 1;
  const reason = found.reason === '' ? null : found.reason;
  emit(step.ctx, 'decision.reconcile', {
    task: flow.task,
    against: found.against,
    outcome: 'contradiction',
    files: [],
    reason,
    inv: found.inv,
    ...partiesField(found.parties),
  });
  openCard(step, flow, {
    against: [found.against],
    red: found.red,
    head: found.head,
    ...(found.parties.length > 1 ? { parties: found.parties, reason } : {}),
  });
}

/** Every party's acceptance tests, by path (a path two parties share is the earlier's). */
function partiesTests(step: V2Step, parties: readonly TaskId[]): Record<string, string> {
  const tests: Record<string, string> = {};
  for (const party of parties.toReversed()) Object.assign(tests, acceptanceTests(step.ctx, party));
  return tests;
}

/** v2.5: the `parties` field of an event, only when the reconcile took in more than one. */
function partiesField(parties: readonly TaskId[]): { parties?: string[] } {
  return parties.length > 1 ? { parties: [...parties] } : {};
}

/** The author's verdict: its `CONTRADICTION:` line if it gave one, else its last line. */
function verdictLine(text: string): string {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const verdict = lines.find((line) => line.startsWith('CONTRADICTION')) ?? lines.at(-1) ?? '';
  return verdict.slice(0, 300);
}
