/**
 * v2.5 dynamic culprits (E6 `dynamic_culprits`, `docs/claude-opus/exp/e6-decision-cards.md`
 * §5.3). v2 names the culprits of a red check by the failing tests' owners, then by landed
 * commits *since the bean's snapshot* whose files the failing tests read. That misses a bean
 * that landed before the snapshot and changed a contract the bean's own tests rely on (t023
 * under t036, in all four v2 runs), and a read set names every bean the app imports.
 *
 * When the bean's own tests fail (and no landed declared partner's do), the landed beans
 * whose files those tests read are probed, wherever they landed: declared partners first,
 * then the newest, at most 6, no more at once than the run has CI slots. A probe reverts one
 * bean from the checked tree and runs the suite in the bean's sandbox; the bean is a culprit
 * when its own failing tests pass without it. The confirmed beans replace the read-set guess;
 * none confirmed means none is named. E6 ranked the candidates by covered lines (`git blame`
 * of a coverage run); the runner reports no coverage, so the order here is partners, then
 * recency.
 *
 * The tail fix bounds the searches. In `cf-v25dep-sonnet-12-s7` t032's every red ran a fresh
 * search of 24 candidates (6 to 12 minutes each) that could never confirm one: two landed
 * beans broke its test together, so leaving either out fixed nothing. Now a bean searches
 * once per set of counterparts its red names (owners, base and read-set culprits; a repeat
 * reuses the answer), and not at all once that set includes a counterpart a card decided:
 * the card already said who the culprit is.
 *
 * Nor when every candidate it would probe was probed by an earlier search of the bean that
 * confirmed none (`cf-demo2-sonnet-30-s7`: t032 spent 8.7 of the race's last 9.5 minutes in three
 * searches of the same six candidates, each `confirmed: []`, under three different sets of
 * named counterparts). Leaving out one of them fixed nothing then; it fixes nothing now.
 */
import type { Sha, TaskId } from '@beanstalk/shared-race/ids';
import { unionPaths } from '@beanstalk/shared-race/run-config';

import { emit, startJob, taskDefinition } from '../context';
import type { CheckResult, JobId, JobResult } from '../model';
import { probeMessage } from '../prompts';
import { isDecided } from './v2-decisions';
import { culpritTasks, startRepair } from './v2-repair';
import type { RedCheck } from './v2-repair';
import { awaitOutcome } from './v2-sprout';
import { declaredPartners } from './v2-start';
import type { LandingFlow, LandingStep, V2Step } from './v2-state';

/**
 * Candidates probed at most. E6 raised it from 8 to 24 (8 missed t033); the tail fix lowers it
 * to 6, since 24 full suites per red kept t032's searches at 6 to 12 minutes each.
 */
const MAX_CANDIDATES = 6;
/** Probes run at once, at most (and never more than the run's CI slots). */
const PROBES_AT_ONCE = 4;

type ProbeStep = Extract<LandingStep, { kind: 'culprit-probe' }>;

/**
 * A red check on `candidate` (the squashed tree): probe for the landed beans that break the
 * bean's own tests, then repair. Without the rule, or when they do not apply, repair at once.
 */
export function repairWithCulprits(
  step: V2Step,
  flow: LandingFlow,
  red: RedCheck & { readonly candidate: Sha | null },
): void {
  const files = ownFailures(step, flow.task, red.red);
  if (!step.ctx.env.config.dynamic_culprits || red.candidate === null || files.length === 0) {
    startRepair(step, flow, red);
    return;
  }
  const known = knownSearch(step, flow.task, red);
  if (known.kind !== 'search') {
    countSkip(step);
    startRepair(step, flow, known.kind === 'repeat' ? { ...red, confirmed: known.confirmed } : red);
    return;
  }
  const queue = candidates(step, flow.task, red.red, files);
  if (wasSearchedEmpty(step, flow.task, queue)) {
    countSkip(step);
    (step.state.dynamicSearches ??= {})[known.key] = [];
    startRepair(step, flow, { ...red, confirmed: [] });
    return;
  }
  step.state.stats.dynamic_culprit_runs += 1;
  flow.step = {
    kind: 'culprit-probe',
    head: red.head,
    red: red.red,
    mine: red.mine,
    candidate: red.candidate,
    files,
    queue,
    probed: [],
    probes: [],
    confirmed: [],
    searchKey: known.key,
  };
  nextBatch(step, flow, flow.step);
}

type KnownSearch =
  | { readonly kind: 'search'; readonly key: string }
  | { readonly kind: 'repeat'; readonly confirmed: readonly TaskId[] }
  | { readonly kind: 'decided' };

/**
 * Whether this red needs a search: not when the counterparts it names include one a card
 * decided, nor when the bean already searched for this set of counterparts (its answer then
 * stands).
 */
function knownSearch(step: V2Step, task: TaskId, red: RedCheck): KnownSearch {
  const { state } = step;
  const named = culpritTasks(step, task, { head: red.head, red: red.red, mine: red.mine });
  if (named.some((culprit) => isDecided(state, task, culprit))) return { kind: 'decided' };
  const key = `${task}|${named.toSorted().join(',')}`;
  const confirmed = state.dynamicSearches?.[key];
  return confirmed === undefined ? { kind: 'search', key } : { kind: 'repeat', confirmed };
}

function countSkip(step: V2Step): void {
  step.state.stats.dynamic_culprit_skips = (step.state.stats.dynamic_culprit_skips ?? 0) + 1;
}

/** Every candidate was probed by one earlier search of the bean that confirmed none. */
function wasSearchedEmpty(step: V2Step, task: TaskId, queue: readonly TaskId[]): boolean {
  const searched = step.state.emptySearches?.[task] ?? [];
  return searched.some((probed) => queue.every((candidate) => probed.includes(candidate)));
}

/** A probe's revert or suite returned (or failed: `result` null). */
export function onProbeJob(
  step: V2Step,
  flow: LandingFlow,
  current: ProbeStep,
  done: { jobId: JobId; result: JobResult | null },
): void {
  const probe = current.probes.find((candidate) => candidate.jobId === done.jobId);
  if (probe === undefined) return;
  const { result } = done;
  if (probe.phase === 'revert' && result?.kind === 'revert' && result.outcome === 'clean') {
    probe.phase = 'check';
    probe.jobId = startJob(
      step.ctx,
      {
        kind: 'check',
        sha: result.sha,
        extraFiles: null,
        instance: { kind: 'sandbox', slot: flow.slot },
      },
      { kind: 'policy' },
    );
    awaitOutcome(step.state, probe.jobId, { kind: 'landing', task: flow.task });
    return;
  }
  if (result?.kind === 'check' && isFixedWithout(result.check, current.files)) {
    current.confirmed.push(probe.task);
  }
  current.probes = current.probes.filter((candidate) => candidate !== probe);
  if (current.probes.length === 0) nextBatch(step, flow, current);
}

/** The bean's own acceptance test files that failed (null failures: none known). */
function ownFailures(step: V2Step, task: TaskId, result: CheckResult): string[] {
  const { ctx } = step;
  const own = Object.keys(taskDefinition(ctx, task).acceptance_tests);
  const failing = result.failingFiles ?? [];
  const partnerTests = new Set(
    declaredPartners(step, task)
      .filter((partner) => typeof ctx.state.tasks[partner]?.landedSha === 'string')
      .flatMap((partner) => Object.keys(taskDefinition(ctx, partner).acceptance_tests)),
  );
  if (failing.some((path) => partnerTests.has(path))) return [];
  return failing.filter((path) => own.includes(path));
}

/** Landed beans on the sprout whose files the failing tests read: partners, then newest. */
function candidates(step: V2Step, task: TaskId, result: CheckResult, files: string[]): TaskId[] {
  const { ctx, state } = step;
  const read = new Set(files.flatMap((path) => result.readSets[path] ?? [path]));
  const landed = state.commits
    .filter((commit) => commit.kind === 'task' && !commit.reverted && commit.task !== task)
    .filter((commit) => ctx.state.tasks[commit.task ?? '']?.status !== 'dropped')
    .filter((commit) => commit.files.some((path) => read.has(path)))
    .flatMap((commit) => (commit.task === null ? [] : [commit.task]))
    .toReversed();
  const partners = declaredPartners(step, task);
  const ordered = [
    ...landed.filter((id) => partners.includes(id)),
    ...landed.filter((id) => !partners.includes(id)),
  ];
  return [...new Set(ordered)].slice(0, MAX_CANDIDATES);
}

/** Starts the next four probes, or ends the search when one confirmed or none is left. */
function nextBatch(step: V2Step, flow: LandingFlow, current: ProbeStep): void {
  if (current.confirmed.length > 0 || current.queue.length === 0) {
    finish(step, flow, current);
    return;
  }
  const atOnce = Math.min(PROBES_AT_ONCE, step.ctx.env.config.ci_slots);
  const batch = current.queue.slice(0, atOnce);
  current.queue = current.queue.slice(atOnce);
  for (const task of batch) {
    const commit = step.state.commits.findLast(
      (candidate) => candidate.task === task && candidate.kind === 'task' && !candidate.reverted,
    );
    if (commit === undefined) continue;
    current.probed.push(task);
    step.state.stats.dynamic_culprit_probes += 1;
    const jobId = startJob(
      step.ctx,
      {
        kind: 'revert',
        onto: current.candidate,
        commit: commit.sha,
        message: probeMessage(commit.sha),
        unionPaths: unionPaths(step.ctx.env.config),
      },
      { kind: 'policy' },
    );
    awaitOutcome(step.state, jobId, { kind: 'landing', task: flow.task });
    current.probes.push({ task, jobId, phase: 'revert' });
  }
  if (current.probes.length === 0) nextBatch(step, flow, current);
}

function finish(step: V2Step, flow: LandingFlow, current: ProbeStep): void {
  const searches = (step.state.dynamicSearches ??= {});
  if (current.searchKey !== undefined) searches[current.searchKey] = [...current.confirmed];
  if (current.confirmed.length === 0 && current.probed.length > 0) {
    const empty = (step.state.emptySearches ??= {});
    empty[flow.task] = [...(empty[flow.task] ?? []), current.probed.toSorted()];
  }
  emit(step.ctx, 'culprit.dynamic', {
    task: flow.task,
    candidates: [...current.probed],
    confirmed: [...current.confirmed],
  });
  startRepair(step, flow, {
    head: current.head,
    red: current.red,
    mine: current.mine,
    confirmed: current.confirmed,
  });
}

/** The probe fixed the bean's failing tests: none of them fails without the candidate. */
function isFixedWithout(result: CheckResult, files: readonly string[]): boolean {
  if (result.failingFiles === null) return false;
  return !result.failingFiles.some((path) => files.includes(path));
}
