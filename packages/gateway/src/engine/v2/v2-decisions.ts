/**
 * Spec-decision cards (plan §6 step 5; `decide` of `policy_beanstalk_v2.py`, and E6 for
 * v2.2). After failed informed reworks against the same landed bean, the pair is a question
 * of specification. A `decision.request` carries both one-line specs; the oracle answers
 * after `decision_seconds`, or a human through the decision route (`decision_mode: human`,
 * with an optional timeout after which the oracle answers).
 *
 * - `decision_outcome: decline` (v2.0): the arriving bean is dropped.
 * - `decision_outcome: reexecute` (v2.2, E6). Nothing landed is ever reverted.
 *   - The landed bean wins (`keep-landed`): a test author amends the arriving loser's
 *     acceptance tests to the decision, proven by failing first on the snapshot, and the
 *     loser is re-executed from the sprout head with the decision and the winner's intent
 *     and diff.
 *   - The arriving bean wins (`adopt-in-place`): the author amends the landed loser's tests
 *     in place, and the winner merges and carries them, landing with them.
 *   Decisions compose: the author and the loser see every earlier decision in force.
 */
import type { Sha, SlotId, TaskId } from '@beanstalk/shared-race/ids';
import { prelandSeconds, releasesOnCheck } from '@beanstalk/shared-race/run-config';

import { failingTestNames } from '../ci';
import type { DecisionAnswer, ReworkOutcome } from '../context';
import {
  acceptanceTests,
  cancelTimer,
  emit,
  promptTask,
  requireTask,
  setTimer,
  startJob,
  taskDefinition,
} from '../context';
import { EngineInvariantError } from '../errors';
import { canResume, createInvocation } from '../invocations';
import type { CheckResult, EngineRefusal, JobId, JobResult } from '../model';
import type { CulpritContext, DecisionContext } from '../prompts';
import { adoptInPlacePrompt, decisionText, reexecutionPrompt, testAuthorPrompt } from '../prompts';
import { SPROUT_REF } from '../refs';
import { holderOf, release } from '../slots';
import { parkTask, taskBranch, taskWorkspace } from '../tasks';
import { requestAgent } from './v2-agents';
import { amend, beanAcceptance, carriedPaths, carry, rollBack } from './v2-amendments';
import { endLanding, failFirstTimerKey, oracleTimerKey, parks } from './v2-flows';
import { awaitOutcome, lastTaskCommit } from './v2-sprout';
import type { DecisionCard, LandingFlow, V2State, V2Step } from './v2-state';

/** Failing tests a card lists (`[:10]`). */
const CARD_FAILING_TESTS = 10;
/** Failing tests a card keeps for its test author (`[:12]`). */
const CARD_KEPT_FAILING_TESTS = 12;
/** Characters of the winner's diff the author and the loser see (`limit=5000`). */
const WINNER_DIFF_CHARS = 5000;
/** Failing tests listed in a fail-first proof (`[:12]`). */
const FAIL_FIRST_TESTS = 12;
/** A runner failure message that marks an amended test file that does not parse. */
const SYNTAX_ERROR = 'SyntaxError';

type Answer = {
  readonly winner: string;
  readonly by: 'oracle' | 'human' | 'human-timeout';
  /** The `oracle` field of `decision.made`. */
  readonly label: string;
  readonly text: string | null;
  readonly waitSeconds: number;
};

/** The pair counter of `pair_reds`: an arriving bean against one landed culprit. */
export function pairKey(task: TaskId, culprit: TaskId): string {
  return `${task}|${culprit}`;
}

/** Whether a card already decided this pair (a pair is never asked twice). */
export function isDecided(state: V2State, task: TaskId, culprit: TaskId): boolean {
  return state.decidedPairs[pairKey(task, culprit)] !== undefined;
}

/** Opens a card for an arriving bean stuck against landed ones. */
export function openCard(
  step: V2Step,
  flow: LandingFlow,
  raised: {
    against: readonly TaskId[];
    red: CheckResult;
    head: Sha;
    /** v2.5: every party of the reconcile that found this contradiction, and its verdict. */
    parties?: readonly TaskId[];
    reason?: string | null;
  },
): void {
  const { ctx, state } = step;
  const isReexecuting = ctx.env.config.decision_outcome === 'reexecute';
  // E6 cards are per pair; v2.0's card names every stuck culprit.
  const against = isReexecuting ? raised.against.slice(0, 1) : [...raised.against];
  state.cardSeq += 1;
  const id = `D${String(state.cardSeq).padStart(3, '0')}`;
  const specs = Object.fromEntries(
    [flow.task, ...against].map((task) => [task, taskDefinition(ctx, task).title]),
  );
  const failing = failingTestNames(raised.red);
  state.stats.cards += 1;
  emit(ctx, 'decision.request', {
    card: id,
    task: flow.task,
    against: [...against],
    specs,
    failing: failing.slice(0, CARD_FAILING_TESTS),
    attempts: Math.max(
      ...against.map((culprit) => state.pairReds[pairKey(flow.task, culprit)] ?? 0),
    ),
    ...(raised.parties === undefined ? {} : { parties: [...raised.parties] }),
    ...(raised.reason === undefined || raised.reason === null ? {} : { reason: raised.reason }),
  });
  const card: DecisionCard = {
    id,
    task: flow.task,
    against: [...against],
    specs,
    openedAt: ctx.now,
    status: 'open',
    timerId: null,
    red: {
      head: raised.head,
      failing: failing.slice(0, CARD_KEPT_FAILING_TESTS),
      output: raised.red.output,
    },
    winner: null,
    loser: null,
    outcome: null,
    text: null,
    by: null,
    snapshot: null,
    winnerContext: null,
    amendment: null,
  };
  state.cards[id] = card;
  flow.step = { kind: 'decision', card: id };
  scheduleAnswer(step, card);
}

/** The oracle answers: its own card in oracle mode, a timed-out human's in human mode. */
export function onOracle(step: V2Step, cardId: string): void {
  const card = step.state.cards[cardId];
  if (card?.status !== 'open') return;
  card.timerId = null;
  const config = step.ctx.env.config;
  const isHuman = config.decision_mode === 'human';
  decide(step, card, {
    winner: oracleWinner(card, config.decision_oracle),
    by: isHuman ? 'human-timeout' : 'oracle',
    label: isHuman ? `timeout:${config.decision_oracle}` : config.decision_oracle,
    text: null,
    waitSeconds: isHuman ? step.ctx.now - card.openedAt : config.decision_seconds,
  });
}

/** A human answers a card (the admin route, or the web app over RPC). */
export function answerCard(step: V2Step, answer: DecisionAnswer): EngineRefusal | null {
  const card = step.state.cards[answer.card];
  if (card?.status !== 'open') {
    return { code: 'unknown_card', message: `no open decision card ${answer.card}` };
  }
  const isContender =
    answer.winner === card.task || card.against.some((landed) => landed === answer.winner);
  if (!isContender) {
    return {
      code: 'invalid_winner',
      message: `the winner of ${card.id} is one of ${[card.task, ...card.against].join(', ')}`,
    };
  }
  cancelTimer(step.ctx, card.timerId);
  card.timerId = null;
  unpark(step, card);
  decide(step, card, {
    winner: answer.winner,
    by: 'human',
    label: `human:${answer.actor}`,
    text: answer.text,
    waitSeconds: step.ctx.now - card.openedAt,
  });
  return null;
}

/**
 * Cards still waiting for an answer, or still being applied. A parked bean's card waits for a
 * person after the race: the race does not wait for it.
 */
export function hasPendingCards(step: V2Step): boolean {
  return Object.values(step.state.cards).some(
    (card) => card.status !== 'done' && step.ctx.state.tasks[card.task]?.status !== 'parked',
  );
}

/** Decisions on a bean's pairs that later amendments and re-executions must keep. */
export function decisionsInForce(state: V2State, task: TaskId, exclude: string): string[] {
  return Object.values(state.cards)
    .filter(
      (card) =>
        card.id !== exclude &&
        card.text !== null &&
        card.outcome !== 'declined' &&
        (card.task === task || card.against.includes(task)),
    )
    .toSorted((a, b) => (a.id < b.id ? -1 : 1))
    .map((card) => `${card.id} (${[card.task, ...card.against].join(' and ')}): ${card.text}`);
}

/** The oracle's timer for a new card, or its answer now (no human, no latency). */
export function scheduleAnswer(step: V2Step, card: DecisionCard): void {
  const config = step.ctx.env.config;
  if (config.decision_mode === 'human') {
    const timeout = config.human_timeout_seconds;
    if (timeout === null || config.decision_oracle === 'none') {
      parkForPerson(step, card);
      return;
    }
    card.timerId = setTimer(step.ctx, timeout, { kind: 'policy', key: oracleTimerKey(card.id) });
    return;
  }
  if (config.decision_oracle === 'none') {
    parkForPerson(step, card);
    return;
  }
  if (config.decision_seconds <= 0) {
    onOracle(step, card.id);
    return;
  }
  card.timerId = setTimer(step.ctx, config.decision_seconds, {
    kind: 'policy',
    key: oracleTimerKey(card.id),
  });
}

/**
 * With `park`, a card only a person answers parks its bean: the race no longer waits for it.
 * The card stays open and the bean keeps its landing flow, so an answer during the race takes
 * it up again (`answerCard`); amendments it carried are rolled back now, as for a drop.
 */
function parkForPerson(step: V2Step, card: DecisionCard): void {
  if (!parks(step.state)) return;
  const against = card.against.join(', ');
  parkTask(
    step.ctx,
    requireTask(step.ctx, card.task),
    `needs a person: decision card ${card.id} (${card.task} vs ${against})`,
  );
  rollBack(step, card.task);
}

/** A person answered a parked bean's card during the race: it is back in play. */
function unpark(step: V2Step, card: DecisionCard): void {
  const task = requireTask(step.ctx, card.task);
  if (task.status !== 'parked') return;
  task.status = 'rework';
  task.parkedReason = null;
}

function oracleWinner(card: DecisionCard, oracle: 'landed' | 'arriving' | 'none'): string {
  const landed = card.against[0];
  if (oracle === 'arriving' || landed === undefined) return card.task;
  return landed;
}

function decide(step: V2Step, card: DecisionCard, answer: Answer): void {
  const { ctx, state } = step;
  card.winner = answer.winner;
  card.by = answer.by;
  card.status = 'decided';
  state.stats.card_details.push({
    card: card.id,
    task: card.task,
    against: [...card.against],
    winner: answer.winner,
    specs: { ...card.specs },
  });
  if (ctx.env.config.decision_outcome === 'decline') {
    decline(step, card, answer);
    return;
  }
  const landed = card.against[0];
  if (landed === undefined) throw new EngineInvariantError(`card ${card.id} has no landed bean`);
  const isArrivingWinner = answer.winner === card.task;
  const loser = isArrivingWinner ? landed : card.task;
  card.outcome = isArrivingWinner ? 'adopt-in-place' : 'keep-landed';
  card.loser = loser;
  card.text =
    answer.text ??
    decisionText(
      { id: answer.winner, title: taskDefinition(ctx, answer.winner).title },
      { id: loser, title: taskDefinition(ctx, loser).title },
    );
  for (const other of card.against) state.decidedPairs[pairKey(card.task, other)] = card.id;
  if (isArrivingWinner) state.stats.adoptions_in_place += 1;
  emit(ctx, 'decision.made', {
    card: card.id,
    winner: answer.winner,
    loser,
    oracle: answer.label,
    wait_seconds: answer.waitSeconds,
    outcome: card.outcome,
    text: card.text,
  });
  fetchWinnerContext(step, card);
}

/** v2.0: the arriving bean is declined, whoever won. */
function decline(step: V2Step, card: DecisionCard, answer: Answer): void {
  const isArrivingWinner = answer.winner === card.task;
  emit(step.ctx, 'decision.made', {
    card: card.id,
    winner: answer.winner,
    loser: isArrivingWinner ? card.against.join(',') : card.task,
    oracle: answer.label,
    wait_seconds: answer.waitSeconds,
  });
  card.status = 'done';
  card.outcome = 'declined';
  endLanding(
    step,
    card.task,
    `declined by decision ${card.id}: the accepted spec of ${answer.winner} was kept`,
  );
}

/**
 * The winner's intent and diff, for the author and the loser: the landed winner's sprout
 * commit, or the arriving winner's change since the sprout it last merged.
 */
function fetchWinnerContext(step: V2Step, card: DecisionCard): void {
  const flow = cardFlow(step, card);
  const winner = card.winner;
  if (flow === undefined || winner === null) return;
  const range = winnerRange(step, card, winner);
  if (range === null) {
    card.winnerContext = winnerContext(step, winner, '(not on trunk)');
    requestAgent(step, flow, { kind: 'author', card: card.id });
    return;
  }
  const jobId = startJob(
    step.ctx,
    { kind: 'diff', parent: range.parent, sha: range.sha, limit: WINNER_DIFF_CHARS },
    { kind: 'policy' },
  );
  awaitOutcome(step.state, jobId, { kind: 'card', card: card.id });
  flow.step = { kind: 'card-context', card: card.id, jobId };
}

function winnerRange(
  step: V2Step,
  card: DecisionCard,
  winner: string,
): { parent: Sha; sha: Sha } | null {
  if (card.outcome === 'adopt-in-place') {
    const arriving = requireTask(step.ctx, winner);
    const { mergedMain, headSha } = arriving;
    return mergedMain === null || headSha === null ? null : { parent: mergedMain, sha: headSha };
  }
  const commit = lastTaskCommit(step.state, requireTask(step.ctx, winner).id);
  return commit === undefined ? null : { parent: commit.parent, sha: commit.sha };
}

function winnerContext(step: V2Step, winner: string, diff: string): CulpritContext {
  const definition = taskDefinition(step.ctx, winner);
  return { task: winner, title: definition.title, intent: definition.prompt, diff };
}

/** The bean whose flow a card drives: always the arriving bean. */
function cardFlow(step: V2Step, card: DecisionCard): LandingFlow | undefined {
  return step.state.landings[card.task];
}

/** A runner job of a decided card returned. */
export function onCardJob(step: V2Step, cardId: string, jobId: JobId, result: JobResult): void {
  const card = step.state.cards[cardId];
  const flow = card === undefined ? undefined : cardFlow(step, card);
  if (card === undefined || flow === undefined) return;
  const current = flow.step;
  if (current.kind === 'card-context' && current.jobId === jobId && result.kind === 'diff') {
    card.winnerContext = winnerContext(step, card.winner ?? card.task, result.text);
    requestAgent(step, flow, { kind: 'author', card: card.id });
    return;
  }
  if (current.kind === 'reading' && current.jobId === jobId && result.kind === 'read-files') {
    onAmendmentRead(step, { flow, card, head: current.head }, result.contents);
    return;
  }
  if (current.kind === 'fail-first' && current.jobId === jobId && result.kind === 'check') {
    current.jobId = null;
    current.result = result.check;
    const latency = prelandSeconds(step.ctx.env.config);
    if (latency > 0) {
      setTimer(step.ctx, latency, { kind: 'policy', key: failFirstTimerKey(flow.task) });
      return;
    }
    judgeFailFirst(step, flow, card);
  }
}

/** A card's job failed for good: the card still goes on, without what the job would give. */
export function onCardJobFailed(step: V2Step, cardId: string, error: string): void {
  const card = step.state.cards[cardId];
  const flow = card === undefined ? undefined : cardFlow(step, card);
  if (card === undefined || flow === undefined) return;
  const phase = flow.step.kind;
  if (phase === 'card-context') {
    card.winnerContext = winnerContext(step, card.winner ?? card.task, '(diff unavailable)');
    requestAgent(step, flow, { kind: 'author', card: card.id });
  } else if (phase === 'reading') {
    finishAmendment(step, { flow, card }, { status: 'none', problems: [error] });
  } else if (phase === 'fail-first') {
    finishAmendment(step, { flow, card }, { status: 'rejected', problems: [error] });
  }
}

/** The fail-first proof's emulated latency elapsed. */
export function onFailFirstElapsed(step: V2Step, task: TaskId): void {
  const flow = step.state.landings[task];
  if (flow?.step.kind !== 'fail-first' || flow.step.result === null) return;
  const card = step.state.cards[flow.step.card];
  if (card !== undefined) judgeFailFirst(step, flow, card);
}

/**
 * The test author for the card's loser: a fresh session in the loser's bean, at the snapshot
 * the loser re-executes from (keep-landed) or the tree the red check ran on (in place).
 */
export function startAuthor(step: V2Step, flow: LandingFlow, slot: SlotId, cardId: string): void {
  const { ctx, state } = step;
  const card = requireCard(state, cardId);
  const loser = card.loser;
  const winner = card.winnerContext;
  if (loser === null || winner === null) {
    throw new EngineInvariantError(`card ${cardId} has no loser`);
  }
  const isInPlace = card.outcome === 'adopt-in-place';
  const snapshot = isInPlace ? card.red.head : state.sprout;
  card.snapshot = snapshot;
  const loserTask = requireTask(ctx, loser);
  const tests = acceptanceTests(ctx, loser);
  const prompt = testAuthorPrompt(
    promptTask(ctx, loser),
    { card: card.id, text: card.text ?? '' },
    {
      winner,
      failing: card.red.failing,
      output: card.red.output,
      inForce: decisionsInForce(state, loser, card.id),
      inPlace: isInPlace,
      ...(ctx.env.config.reconcile ? { winnerTests: failingTestsOf(step, winner.task, card) } : {}),
    },
  );
  flow.step = { kind: 'authoring', card: card.id };
  const inv = createInvocation(ctx, {
    kind: 'test-author',
    task: loser,
    slot,
    attempt: 1,
    prompt,
    freshPrompt: prompt,
    resume: null,
    workspace: (id) =>
      taskWorkspace(ctx, loserTask, {
        kind: 'test-author',
        inv: id,
        merge: null,
        base: snapshot,
        head: null,
        acceptance: tests,
      }),
    replay: { reset_to: null, check: null, fixes: [] },
  });
  if (inv !== null) state.authors[inv] = card.id;
}

/** v2.4: the card's failing tests that `owner` owns, as they are now. */
function failingTestsOf(step: V2Step, owner: string, card: DecisionCard): Record<string, string> {
  const files = new Set(card.red.failing.map((test) => test.split(' > ')[0] ?? test));
  return Object.fromEntries(
    Object.entries(acceptanceTests(step.ctx, owner)).filter(([path]) => files.has(path)),
  );
}

/** The test author finished: read what it changed in the loser's tests. */
export function onAuthorDone(step: V2Step, outcome: ReworkOutcome): void {
  const { ctx, state } = step;
  const cardId = state.authors[outcome.inv];
  delete state.authors[outcome.inv];
  const card = cardId === undefined ? undefined : state.cards[cardId];
  const flow = card === undefined ? undefined : cardFlow(step, card);
  if (card === undefined || flow?.step.kind !== 'authoring') return;
  if (releasesOnCheck(ctx.env.config) && holderOf(ctx, flow.task)?.id === outcome.slot) {
    release(ctx, outcome.slot);
  }
  const loser = card.loser;
  if (!outcome.committed || outcome.headSha === null || loser === null) {
    const problems =
      outcome.infraError === null ? [] : [`test author failed: ${outcome.infraError}`];
    finishAmendment(step, { flow, card, inv: outcome.inv }, { status: 'none', problems });
    return;
  }
  const head = outcome.headSha;
  const reads = Object.keys(acceptanceTests(ctx, loser)).map((path) => ({ ref: head, path }));
  const jobId = startJob(ctx, { kind: 'read-files', reads }, { kind: 'policy' });
  awaitOutcome(state, jobId, { kind: 'card', card: card.id });
  flow.step = { kind: 'reading', card: card.id, head, jobId };
}

/** The loser's tests as the author left them: none changed, in place, or to be proven. */
function onAmendmentRead(
  step: V2Step,
  read: { flow: LandingFlow; card: DecisionCard; head: Sha },
  contents: readonly (string | null)[],
): void {
  const { flow, card, head } = read;
  const loser = card.loser;
  if (loser === null) return;
  const before = acceptanceTests(step.ctx, loser);
  const changed: Record<string, string> = {};
  Object.keys(before).forEach((path, index) => {
    const content = contents[index];
    if (typeof content === 'string' && content !== before[path]) changed[path] = content;
  });
  if (Object.keys(changed).length === 0) {
    finishAmendment(step, { flow, card }, { status: 'none', problems: [] });
    return;
  }
  if (card.outcome === 'adopt-in-place') {
    finishAmendment(step, { flow, card }, { status: 'amended', problems: [], changed, head });
    return;
  }
  const snapshot = card.snapshot;
  if (snapshot === null) throw new EngineInvariantError(`card ${card.id} has no snapshot`);
  const jobId = startJob(
    step.ctx,
    {
      kind: 'check',
      sha: snapshot,
      extraFiles: changed,
      instance: { kind: 'sandbox', slot: flow.slot },
    },
    { kind: 'policy' },
  );
  awaitOutcome(step.state, jobId, { kind: 'card', card: card.id });
  flow.step = {
    kind: 'fail-first',
    card: card.id,
    changed,
    jobId,
    startedAt: step.ctx.now,
    result: null,
  };
}

/**
 * The fail-first proof: on the snapshot, where the loser is not implemented, at least one
 * amended file must fail, and none for a syntax error (the runner's parse check).
 */
function judgeFailFirst(step: V2Step, flow: LandingFlow, card: DecisionCard): void {
  const current = flow.step;
  if (current.kind !== 'fail-first' || current.result === null || card.loser === null) return;
  const result = current.result;
  const changedPaths = new Set(Object.keys(current.changed));
  const loserPaths = new Set(Object.keys(acceptanceTests(step.ctx, card.loser)));
  const failingFiles = (result.failingFiles ?? []).filter((path) => loserPaths.has(path));
  const unparsable = result.failingTests
    .filter((test) => changedPaths.has(test.file) && (test.message ?? '').includes(SYNTAX_ERROR))
    .map((test) => test.file);
  const problems = [
    ...(unparsable.length > 0 ? [`does not parse: ${[...new Set(unparsable)].join(', ')}`] : []),
    ...(failingFiles.some((path) => changedPaths.has(path))
      ? []
      : [
          'fail-first: the amended test files pass on the snapshot, where the task is not implemented',
        ]),
  ];
  const failFirst = {
    sha: card.snapshot ?? '',
    failing_files: failingFiles,
    failing_tests: failingTestNames(result)
      .filter((name) => loserPaths.has(name.split(' > ')[0] ?? ''))
      .slice(0, FAIL_FIRST_TESTS),
  };
  finishAmendment(
    step,
    { flow, card },
    problems.length > 0
      ? { status: 'rejected', problems, failFirst }
      : { status: 'amended', problems: [], changed: current.changed, head: null, failFirst },
  );
}

type FailFirstEvidence = {
  readonly sha: string;
  readonly failing_files: readonly string[];
  readonly failing_tests: readonly string[];
};

type AmendmentResult =
  | {
      readonly status: 'amended';
      readonly problems: readonly string[];
      readonly changed: Readonly<Record<string, string>>;
      readonly head: Sha | null;
      readonly failFirst?: FailFirstEvidence;
    }
  | {
      readonly status: 'none' | 'rejected';
      readonly problems: readonly string[];
      readonly failFirst?: FailFirstEvidence;
    };

/** Records the author's result (`spec.amended`) and applies the decision. */
function finishAmendment(
  step: V2Step,
  where: { flow: LandingFlow; card: DecisionCard; inv?: string },
  result: AmendmentResult,
): void {
  const { ctx, state } = step;
  const { flow, card } = where;
  const loser = card.loser;
  if (loser === null) throw new EngineInvariantError(`card ${card.id} has no loser`);
  const isInPlace = card.outcome === 'adopt-in-place';
  const files = result.status === 'amended' ? { ...result.changed } : {};
  card.amendment = {
    status: result.status,
    files,
    head: result.status === 'amended' ? result.head : null,
  };
  if (result.status === 'amended') {
    state.stats.amendments += 1;
    applyAmendment(step, { card, loser, files, isInPlace });
  } else if (result.status === 'none') {
    state.stats.amendments_none += 1;
  } else {
    state.stats.amendments_rejected += 1;
  }
  emit(ctx, 'spec.amended', {
    card: card.id,
    task: loser,
    status: result.status,
    paths: Object.keys(result.status === 'amended' ? files : {}).toSorted(),
    in_place: isInPlace,
    fail_first: result.failFirst ?? null,
    problems: [...result.problems],
    inv: where.inv ?? null,
  });
  card.status = 'done';
  requestAgent(step, flow, { kind: nextWork(card), card: card.id });
}

/** After the amendment: a start card's initial run, the winner's adoption, or the loser's re-execution. */
function nextWork(card: DecisionCard): 'start' | 'adopt' | 'reexec' {
  if (card.trigger === 'start') return 'start';
  return card.outcome === 'adopt-in-place' ? 'adopt' : 'reexec';
}

/** keep-landed: the loser's tests are amended now; in place: the winner carries them. */
function applyAmendment(
  step: V2Step,
  amendment: {
    card: DecisionCard;
    loser: TaskId;
    files: Record<string, string>;
    isInPlace: boolean;
  },
): void {
  const { card, loser, files } = amendment;
  if (!amendment.isInPlace) {
    amend(step, loser, files);
    return;
  }
  const head = card.amendment?.head;
  if (head === undefined || head === null) return;
  const before = acceptanceTests(step.ctx, loser);
  carry(step.state, card.task, {
    card: card.id,
    loser,
    files,
    before: Object.fromEntries(Object.keys(files).map((path) => [path, before[path] ?? ''])),
    head,
  });
}

/**
 * keep-landed: the loser starts over in a fresh session from the sprout head, with the
 * decision, the winner's intent and diff, and its (amended) tests (E6 `reexecute_in_place`).
 */
export function startReexecution(
  step: V2Step,
  flow: LandingFlow,
  slot: SlotId,
  cardId: string,
): void {
  const { ctx, state } = step;
  const card = requireCard(state, cardId);
  const task = requireTask(ctx, flow.task);
  const head = state.sprout;
  task.baseSha = head;
  task.mergedMain = head;
  task.headSha = null;
  task.status = 'rework';
  task.reworks += 1;
  flow.rounds = 0;
  flow.rechecks = 0;
  state.stats.reexecutions += 1;
  const amended = Object.keys(card.amendment?.files ?? {});
  const prompt = reexecutionPrompt(promptTask(ctx, flow.task), decisionOf(card), {
    winner: card.winnerContext,
    amended,
    inForce: decisionsInForce(state, flow.task, card.id),
  });
  emit(ctx, 'rework.start', {
    task: flow.task,
    ticket: null,
    reason: 'decision',
    attempt: 1,
    resumed: false,
    card: card.id,
  });
  flow.step = { kind: 'rework', reason: 'decision' };
  createInvocation(ctx, {
    kind: 'rework',
    task: flow.task,
    slot,
    attempt: 1,
    prompt,
    freshPrompt: prompt,
    resume: null,
    workspace: (inv) =>
      taskWorkspace(ctx, task, {
        kind: 'rework',
        inv,
        merge: null,
        base: head,
        head: null,
        acceptance: beanAcceptance(step, flow.task),
        unprotect: carriedPaths(step, flow.task),
      }),
    replay: { reset_to: head, check: 'acceptance', fixes: [] },
  });
}

/**
 * adopt-in-place: the winner's session merges the author's commit (the loser's amended
 * tests on the tree its red check ran on), keeps the amended tests, and lands with them.
 */
export function startAdoptRework(
  step: V2Step,
  flow: LandingFlow,
  slot: SlotId,
  cardId: string,
): void {
  const { ctx, state } = step;
  const card = requireCard(state, cardId);
  const loser = card.loser;
  if (loser === null) throw new EngineInvariantError(`card ${cardId} has no loser`);
  const task = requireTask(ctx, flow.task);
  const resumed = canResume(ctx, task);
  task.reworks += 1;
  task.status = 'rework';
  const amended = Object.keys(card.amendment?.files ?? {});
  const authorHead = card.amendment?.head ?? null;
  const merge =
    authorHead === null
      ? { sha: card.red.head, ref: SPROUT_REF, conflicts: [] }
      : { sha: authorHead, ref: `refs/heads/${taskBranch(loser)}`, conflicts: [] };
  const prompt = (isResumed: boolean): string =>
    adoptInPlacePrompt(promptTask(ctx, flow.task), decisionOf(card), {
      loser: { id: loser, title: taskDefinition(ctx, loser).title },
      amended,
      inForce: decisionsInForce(state, flow.task, card.id),
      resumed: isResumed,
    });
  emit(ctx, 'rework.start', {
    task: flow.task,
    ticket: null,
    reason: 'decision',
    attempt: flow.rounds,
    resumed,
    card: card.id,
  });
  flow.step = { kind: 'rework', reason: 'decision' };
  createInvocation(ctx, {
    kind: 'rework',
    task: flow.task,
    slot,
    attempt: flow.rounds,
    prompt: prompt(resumed),
    freshPrompt: prompt(false),
    resume: resumed ? task.sessionId : null,
    workspace: (inv) =>
      taskWorkspace(ctx, task, {
        kind: 'rework',
        inv,
        merge,
        acceptance: beanAcceptance(step, flow.task),
        unprotect: carriedPaths(step, flow.task),
      }),
    mergedLine: card.red.head,
    replay: { reset_to: card.red.head, check: 'acceptance', fixes: [] },
  });
}

export function decisionOf(card: DecisionCard): DecisionContext {
  return { card: card.id, text: card.text ?? '', by: card.by ?? 'oracle' };
}

export function requireCard(state: V2State, id: string): DecisionCard {
  const card = state.cards[id];
  if (card === undefined) throw new EngineInvariantError(`no decision card ${id}`);
  return card;
}
