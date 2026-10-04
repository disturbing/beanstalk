/**
 * Repair tickets for red validations, revert-first (plan §6 step 6; `open_ticket`,
 * `bisect_trunk` and `revert_culprit` of `policy_beanstalk.py` with v2's override): a red
 * validation names suspects by read set, or bisects when none; then the culprit is found
 * by K-ary search on CI (leave-one-out when history misleads), reverted on the sprout in
 * the turn, and its task dropped. Nothing is ever fixed forward.
 */
import type { Sha } from '@beanstalk/shared-race/ids';
import { unionPaths } from '@beanstalk/shared-race/run-config';

import { markAborted } from '../abort';
import { bisectPoints } from '../bisect';
import { requestCi } from '../ci';
import { emit, requireTask, startJob, taskDefinition } from '../context';
import { EngineInvariantError } from '../errors';
import type { CheckResult, CiId, JobId, JobResult } from '../model';
import { roundTo } from '../numbers';
import { probeMessage, revertMessage } from '../prompts';
import { SPROUT_REF } from '../refs';
import { dropTask } from '../tasks';
import { rollBack } from './v2-amendments';
import { awaitOutcome, landRevert, requireCommit, sproutIndex } from './v2-sprout';
import type { FirstBadSearch, RevertFlow, Ticket, TicketStatus, V2State, V2Step } from './v2-state';
import { releaseTurn, requestTurn } from './v2-turn';

/** Ticket statuses that still count as an open red (`ACTIVE`; v2 has no fixer states). */
const ACTIVE: ReadonlySet<TicketStatus> = new Set(['bisecting', 'open', 'reverting']);
/** Failing tests a ticket lists (`[:20]`). */
const TICKET_FAILING_TESTS = 20;
/** Import hops assumed when the runner reports none (`.get(w, 99)`). */
const UNKNOWN_HOPS = 99;
const REVERT_FIRST = 'revert-first: no fix-forward on the trunk';

export function activeTickets(state: V2State): Ticket[] {
  return Object.values(state.tickets).filter((ticket) => ACTIVE.has(ticket.status));
}

/** `open_ticket` (with v2's revert-first): a red validation at `idx` with new failures. */
export function openTicket(
  step: V2Step,
  red: { idx: number; result: CheckResult; files: readonly string[]; early?: boolean },
): void {
  const { ctx, state } = step;
  state.ticketSeq += 1;
  const id = `R${String(state.ticketSeq).padStart(3, '0')}`;
  const ticket = newTicket(step, id, red);
  state.tickets[id] = ticket;
  state.stats.tickets += 1;
  const suspects =
    ticket.failingFiles.length > 0
      ? suspectsFor(state, red.idx, red.result, ticket.failingFiles)
      : [];
  if (suspects.length === 0) {
    ticket.method = 'bisect';
    ticket.status = 'bisecting';
    emit(ctx, 'ticket.bisect', { ticket: id, red_idx: red.idx, failing: [...ticket.failingFiles] });
    const search = newSearch(state.greenIdx, red.idx, ticket.failingFiles);
    state.bisects[id] = search;
    if (probeRound(step, id, search)) onSearchDone(step, id, search.hi);
    return;
  }
  ticket.suspects = suspects;
  ticket.concurrent = concurrentFor(step, suspects, readSetOf(red.result, ticket.failingFiles));
  ticketOpened(step, ticket);
  revertFirst(step, ticket);
}

/** `close`: the ticket's tests pass again. */
export function closeTicket(step: V2Step, ticket: Ticket, how: string): void {
  const { ctx, state } = step;
  ticket.status = 'closed';
  ticket.closedAt = ctx.now;
  ticket.closedHow = how;
  state.stats.tickets_closed += 1;
  emit(ctx, 'ticket.close', {
    ticket: ticket.id,
    how,
    attempts: ticket.attempt,
    open_seconds: roundTo(ctx.now - ticket.openedAt, 2),
  });
}

/** A bisection or culprit-search probe finished on CI. */
export function onProbe(step: V2Step, ticketId: string, ciId: CiId, result: CheckResult): void {
  const search = searchOf(step.state, ticketId);
  const point = search?.probes[ciId];
  if (search === undefined || point === undefined) return;
  delete search.probes[ciId];
  search.bad[point] = isBad(result, search.files);
  if (Object.keys(search.probes).length > 0) return;
  step.state.stats.trunk_bisect_runs += search.points.length;
  const reds = search.points.filter((probed) => search.bad[probed] === true);
  if (reds.length > 0) {
    const hi = Math.min(...reds);
    const goods = search.points.filter((probed) => search.bad[probed] !== true && probed < hi);
    search.lo = Math.max(search.lo, ...goods);
    search.hi = hi;
  } else {
    search.lo = Math.max(...search.points);
  }
  if (probeRound(step, ticketId, search)) onSearchDone(step, ticketId, search.hi);
}

/** A leave-one-out probe commit was built (or conflicted). */
export function onLeaveOneOutBuilt(
  step: V2Step,
  wait: { ticket: string; commit: number },
  result: JobResult,
): void {
  const flow = step.state.reverts[wait.ticket];
  if (flow?.phase !== 'leave-one-out' || result.kind !== 'revert') return;
  const probe = flow.probes.find((candidate) => candidate.commit === wait.commit);
  if (probe === undefined) return;
  probe.isBuilt = true;
  probe.sha = result.outcome === 'clean' ? result.sha : null;
  if (flow.probes.some((candidate) => !candidate.isBuilt)) return;
  const runnable = flow.probes.filter((candidate) => candidate.sha !== null);
  if (runnable.length === 0) {
    nextLeaveOneOutBatch(step, wait.ticket);
    return;
  }
  for (const candidate of runnable) {
    if (candidate.sha === null) continue;
    const commit = requireCommit(step.state, candidate.commit);
    candidate.ciId = requestCi(step.ctx, {
      sha: candidate.sha,
      purpose: 'bisect',
      meta: { ticket: wait.ticket, without: commit.task ?? commit.kind },
      owner: 'policy',
    });
    awaitOutcome(step.state, candidate.ciId, {
      kind: 'loo-check',
      ticket: wait.ticket,
      commit: candidate.commit,
    });
  }
}

/** A leave-one-out probe's suite finished. */
export function onLeaveOneOutChecked(
  step: V2Step,
  wait: { ticket: string; commit: number },
  result: CheckResult,
): void {
  const { state } = step;
  const flow = state.reverts[wait.ticket];
  if (flow?.phase !== 'leave-one-out') return;
  const probe = flow.probes.find((candidate) => candidate.commit === wait.commit);
  if (probe === undefined) return;
  probe.result = result;
  const runnable = flow.probes.filter((candidate) => candidate.sha !== null);
  if (runnable.some((candidate) => candidate.result === null)) return;
  state.stats.trunk_bisect_runs += runnable.length;
  const files = requireTicket(state, wait.ticket).failingFiles;
  const fixed = runnable.find(
    (candidate) => candidate.result !== null && isFixedWithout(candidate.result, files),
  );
  if (fixed !== undefined) {
    culpritChosen(step, wait.ticket, { idx: flow.idx, target: fixed.commit });
    return;
  }
  nextLeaveOneOutBatch(step, wait.ticket);
}

/** The ticket's turn came: revert the culprit on the sprout. */
export function onRevertTurn(step: V2Step, ticketId: string): void {
  const { ctx, state } = step;
  const flow = state.reverts[ticketId];
  const ticket = requireTicket(state, ticketId);
  if (flow?.phase !== 'queued' || ticket.status !== 'reverting') {
    delete state.reverts[ticketId];
    releaseTurn(step);
    return;
  }
  const target = requireCommit(state, flow.target);
  const title = target.task === null ? target.sha : taskDefinition(ctx, target.task).title;
  const head = state.sprout;
  const jobId = startJob(
    ctx,
    {
      kind: 'revert',
      onto: head,
      commit: target.sha,
      message: revertMessage(title, target.sha, ticketId),
      unionPaths: unionPaths(ctx.env.config),
    },
    { kind: 'policy' },
  );
  awaitOutcome(state, jobId, { kind: 'ticket-revert', ticket: ticketId });
  state.reverts[ticketId] = { phase: 'revert', target: flow.target, head, jobId };
}

/** The culprit's revert, or the sprout update that lands it, returned. */
export function onTicketRevertJob(
  step: V2Step,
  ticketId: string,
  jobId: JobId,
  result: JobResult,
): void {
  const flow = step.state.reverts[ticketId];
  if (flow?.phase === 'revert' && flow.jobId === jobId && result.kind === 'revert') {
    onCulpritReverted(step, ticketId, flow, result);
    return;
  }
  if (flow?.phase === 'publish' && flow.jobId === jobId && result.kind === 'update-ref') {
    onRevertPublished(step, ticketId, flow, result.ok || result.actual === flow.sha);
  }
}

function newTicket(
  step: V2Step,
  id: string,
  red: { idx: number; result: CheckResult; files: readonly string[]; early?: boolean },
): Ticket {
  const files = new Set(red.files);
  const tests = red.result.failingTests
    .filter((test) => files.has(test.file))
    .map((test) => `${test.file} > ${test.name}`)
    .slice(0, TICKET_FAILING_TESTS);
  return {
    id,
    openedAt: step.ctx.now,
    redSha: requireCommit(step.state, red.idx).sha,
    redIdx: red.idx,
    failingFiles: red.files.filter((path) => !path.startsWith('(')),
    failingTests: tests.length > 0 ? tests : [...red.files],
    output: red.result.output,
    suspects: [],
    concurrent: [],
    method: 'read-set',
    attempt: 1,
    status: 'open',
    revertIdx: null,
    closedAt: null,
    closedHow: null,
    early: red.early === true,
  };
}

/** `ticket_opened`. */
function ticketOpened(step: V2Step, ticket: Ticket): void {
  const { ctx, state } = step;
  const byMethod = state.stats.tickets_by_method;
  byMethod[ticket.method] = (byMethod[ticket.method] ?? 0) + 1;
  state.stats.suspects_per_ticket.push(ticket.suspects.length);
  emit(ctx, 'ticket.open', {
    ticket: ticket.id,
    red_sha: ticket.redSha,
    red_idx: ticket.redIdx,
    failing: [...ticket.failingFiles],
    method: ticket.method,
    suspects: ticket.suspects.map((idx) => {
      const commit = requireCommit(state, idx);
      return { idx, sha: commit.sha, task: commit.task, kind: commit.kind };
    }),
    concurrent: ticket.concurrent.map((idx) => ({ idx, task: requireCommit(state, idx).task })),
    ...(ticket.early ? { early: true } : {}),
  });
}

/** v2's `open_ticket` override: no fixer; escalate at once to the revert path. */
function revertFirst(step: V2Step, ticket: Ticket): void {
  const { ctx, state } = step;
  state.stats.revert_first += 1;
  ticket.attempt = ctx.env.config.max_fix_attempts + 1;
  ticket.status = 'reverting';
  state.stats.tickets_escalated += 1;
  emit(ctx, 'ticket.escalate', {
    ticket: ticket.id,
    why: REVERT_FIRST,
    attempts: ticket.attempt - 1,
  });
  startRevert(step, ticket);
}

/** `revert_culprit`: the first bad commit by K-ary search, unless green caught up. */
function startRevert(step: V2Step, ticket: Ticket): void {
  const { state } = step;
  if (ticket.redIdx <= state.greenIdx) {
    culpritFound(step, ticket.id, -1);
    return;
  }
  const search = newSearch(state.greenIdx, ticket.redIdx, ticket.failingFiles);
  state.reverts[ticket.id] = { phase: 'bisect', search };
  if (probeRound(step, ticket.id, search)) culpritFound(step, ticket.id, search.hi);
}

/** `first_bad`, one round: K probes between lo and hi; true once the search is over. */
function probeRound(step: V2Step, ticketId: string, search: FirstBadSearch): boolean {
  if (search.hi - search.lo <= 1) return true;
  search.points = bisectPoints(search.lo, search.hi, step.ctx.env.config.ci_slots);
  search.probes = {};
  for (const point of search.points) {
    const ciId = requestCi(step.ctx, {
      sha: requireCommit(step.state, point).sha,
      purpose: 'bisect',
      meta: { ticket: ticketId, trunk_idx: point },
      owner: 'policy',
    });
    search.probes[ciId] = point;
    awaitOutcome(step.state, ciId, { kind: 'probe', ticket: ticketId });
  }
  return false;
}

function newSearch(lo: number, hi: number, files: readonly string[]): FirstBadSearch {
  return { lo, hi, files: [...files], points: [], probes: {}, bad: {} };
}

function searchOf(state: V2State, ticketId: string): FirstBadSearch | undefined {
  const bisect = state.bisects[ticketId];
  if (bisect !== undefined) return bisect;
  const flow = state.reverts[ticketId];
  return flow?.phase === 'bisect' ? flow.search : undefined;
}

/** `bad(r)` of `first_bad`: the ticket's files fail (any failure when it names none). */
function isBad(result: CheckResult, files: readonly string[]): boolean {
  if (files.length === 0 || result.failingFiles === null) return !result.green;
  return result.failingFiles.some((path) => files.includes(path));
}

function onSearchDone(step: V2Step, ticketId: string, hi: number): void {
  if (step.state.bisects[ticketId] !== undefined) {
    delete step.state.bisects[ticketId];
    bisectDone(step, ticketId, hi);
    return;
  }
  culpritFound(step, ticketId, hi);
}

/**
 * `bisect_trunk`'s tail: the ticket opens with the first bad commit as its suspect. v2 then
 * reverts it too (the harness would dispatch a fixer here; plan §6 says never fix forward).
 */
function bisectDone(step: V2Step, ticketId: string, hi: number): void {
  const { state } = step;
  const ticket = requireTicket(state, ticketId);
  if (ticket.status !== 'bisecting') return;
  ticket.suspects = hi > state.greenIdx ? [hi] : [];
  ticket.status = 'open';
  ticketOpened(step, ticket);
  if (state.greenIdx >= ticket.redIdx) {
    closeTicket(step, ticket, `green at trunk #${state.greenIdx} during bisection`);
    return;
  }
  revertFirst(step, ticket);
}

/** `first_bad` answered `idx`: revert it, or remove suspects one by one when it misleads. */
function culpritFound(step: V2Step, ticketId: string, idx: number): void {
  const { state } = step;
  const target = idx > state.greenIdx ? state.commits[idx] : undefined;
  if (target === undefined || target.reverted || target.kind === 'revert') {
    startLeaveOneOut(step, ticketId, idx);
    return;
  }
  culpritChosen(step, ticketId, { idx, target: target.idx });
}

/** `leave_one_out`: revert each live unvalidated commit from the head, K at a time. */
function startLeaveOneOut(step: V2Step, ticketId: string, idx: number): void {
  const { state } = step;
  const candidates = state.commits
    .slice(state.greenIdx + 1)
    .toReversed()
    .filter((commit) => commit.kind !== 'revert' && !commit.reverted)
    .map((commit) => commit.idx);
  state.reverts[ticketId] = {
    phase: 'leave-one-out',
    idx,
    head: state.sprout,
    candidates,
    offset: 0,
    probes: [],
  };
  nextLeaveOneOutBatch(step, ticketId);
}

function nextLeaveOneOutBatch(step: V2Step, ticketId: string): void {
  const { ctx, state } = step;
  const flow = state.reverts[ticketId];
  if (flow?.phase !== 'leave-one-out') return;
  const width = Math.max(1, ctx.env.config.ci_slots);
  const batch = flow.candidates.slice(flow.offset, flow.offset + width);
  flow.offset += width;
  if (batch.length === 0) {
    culpritChosen(step, ticketId, { idx: flow.idx, target: null });
    return;
  }
  flow.probes = batch.map((commit) => ({
    commit,
    sha: null,
    isBuilt: false,
    ciId: null,
    result: null,
  }));
  for (const idx of batch) buildProbe(step, ticketId, { head: flow.head, idx });
}

function buildProbe(step: V2Step, ticketId: string, probe: { head: Sha; idx: number }): void {
  const commit = requireCommit(step.state, probe.idx);
  const jobId = startJob(
    step.ctx,
    {
      kind: 'revert',
      onto: probe.head,
      commit: commit.sha,
      message: probeMessage(commit.sha),
      unionPaths: unionPaths(step.ctx.env.config),
    },
    { kind: 'policy' },
  );
  awaitOutcome(step.state, jobId, { kind: 'loo-revert', ticket: ticketId, commit: probe.idx });
}

/** A probe without a commit fixes the ticket: its failing files pass (or the suite is green). */
function isFixedWithout(result: CheckResult, files: readonly string[]): boolean {
  if (result.failingFiles === null) return false;
  const stillFailing = result.failingFiles.some((path) => files.includes(path));
  return !stillFailing && (files.length > 0 || result.green);
}

/** The culprit is known (or not): log it and queue for the turn, or give the ticket up. */
function culpritChosen(
  step: V2Step,
  ticketId: string,
  choice: { idx: number; target: number | null },
): void {
  const { ctx, state } = step;
  const ticket = requireTicket(state, ticketId);
  if (ticket.status !== 'reverting') {
    delete state.reverts[ticketId];
    return;
  }
  const target = choice.target === null ? undefined : state.commits[choice.target];
  if (target === undefined || target.reverted || target.kind === 'revert') {
    ticket.status = 'escalated';
    emit(ctx, 'ticket.stuck', { ticket: ticketId, culprit_idx: choice.idx });
    delete state.reverts[ticketId];
    return;
  }
  emit(ctx, 'ticket.culprit', {
    ticket: ticketId,
    trunk_idx: choice.idx,
    task: target.task,
    kind: target.kind,
  });
  state.reverts[ticketId] = { phase: 'queued', idx: choice.idx, target: target.idx };
  requestTurn(step, { kind: 'revert', ticket: ticketId });
}

function onCulpritReverted(
  step: V2Step,
  ticketId: string,
  flow: Extract<RevertFlow, { phase: 'revert' }>,
  result: Extract<JobResult, { kind: 'revert' }>,
): void {
  const { ctx, state } = step;
  const target = requireCommit(state, flow.target);
  if (result.outcome === 'conflict') {
    requireTicket(state, ticketId).status = 'escalated';
    emit(ctx, 'revert.conflict', { ticket: ticketId, task: target.task, files: [...result.files] });
    delete state.reverts[ticketId];
    releaseTurn(step);
    return;
  }
  const jobId = startJob(
    ctx,
    { kind: 'update-ref', ref: SPROUT_REF, newSha: result.sha, oldSha: flow.head },
    { kind: 'policy' },
  );
  awaitOutcome(state, jobId, { kind: 'ticket-revert', ticket: ticketId });
  state.reverts[ticketId] = {
    phase: 'publish',
    target: flow.target,
    head: flow.head,
    sha: result.sha,
    files: [...result.files],
    jobId,
  };
}

function onRevertPublished(
  step: V2Step,
  ticketId: string,
  flow: Extract<RevertFlow, { phase: 'publish' }>,
  isMoved: boolean,
): void {
  const { ctx, state } = step;
  if (!isMoved) {
    markAborted(ctx, `the sprout moved unexpectedly while reverting for ${ticketId}`);
    return;
  }
  const target = requireCommit(state, flow.target);
  const ticket = requireTicket(state, ticketId);
  const commit = landRevert(step, {
    target,
    head: flow.head,
    sha: flow.sha,
    files: flow.files,
    ticket: ticketId,
  });
  ticket.status = 'reverted';
  ticket.revertIdx = commit.idx;
  emit(ctx, 'revert', {
    ticket: ticketId,
    task: target.task,
    reverted: target.sha,
    sha: commit.sha,
    trunk_idx: commit.idx,
  });
  delete state.reverts[ticketId];
  releaseTurn(step);
  if (target.task !== null) {
    dropTask(ctx, requireTask(ctx, target.task), `reverted: repair ticket ${ticketId} escalated`);
    rollBack(step, target.task);
  }
}

/** `read_set`: what the failing tests read (a test with no closure reads itself). */
function readSetOf(result: CheckResult, files: readonly string[]): Set<string> {
  return new Set(files.flatMap((path) => result.readSets[path] ?? [path]));
}

/**
 * `suspects_for`: unvalidated commits whose writes intersect the failing tests' read sets,
 * most likely first (a write in a failure's stack trace, then fewest import hops, newest).
 */
function suspectsFor(
  state: V2State,
  idx: number,
  result: CheckResult,
  files: readonly string[],
): number[] {
  const read = readSetOf(result, files);
  const stack = new Set(result.stackFiles);
  const ranked: [number, number, number, number][] = [];
  for (const commit of state.commits.slice(state.greenIdx + 1, idx + 1)) {
    const hit = commit.files.filter((path) => read.has(path));
    if (commit.reverted || commit.kind === 'revert' || hit.length === 0) continue;
    const hops = Math.min(
      ...files.flatMap((test) =>
        hit.map((path) => result.readDepths[test]?.[path] ?? UNKNOWN_HOPS),
      ),
    );
    ranked.push([hit.some((path) => stack.has(path)) ? 0 : 1, hops, -commit.idx, commit.idx]);
  }
  return ranked.toSorted(compareTuples).map((entry) => entry[3]);
}

function compareTuples(a: readonly number[], b: readonly number[]): number {
  for (let index = 0; index < a.length; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * `concurrent_for`: commits that landed after a suspect's snapshot (so it never saw them)
 * and wrote what the failing tests read. Context only.
 */
function concurrentFor(
  step: V2Step,
  suspects: readonly number[],
  read: ReadonlySet<string>,
): number[] {
  const { ctx, state } = step;
  const found = new Set<number>();
  for (const idx of suspects) {
    const commit = requireCommit(state, idx);
    const task = commit.task === null ? undefined : ctx.state.tasks[commit.task];
    if (task?.baseSha === null || task?.baseSha === undefined) continue;
    const snapshot = sproutIndex(state, task.baseSha);
    for (const other of state.commits.slice(snapshot + 1, idx)) {
      const isCandidate =
        !suspects.includes(other.idx) && !other.reverted && other.kind !== 'revert';
      if (isCandidate && other.files.some((path) => read.has(path))) found.add(other.idx);
    }
  }
  return [...found].toSorted((a, b) => a - b);
}

function requireTicket(state: V2State, id: string): Ticket {
  const ticket = state.tickets[id];
  if (ticket === undefined) throw new EngineInvariantError(`no ticket ${id}`);
  return ticket;
}
