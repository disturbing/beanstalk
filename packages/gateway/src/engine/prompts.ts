/**
 * The prompts the harness sends, ported verbatim from `research/race/harness/prompts.py`
 * (`preland_red` from `policy_beanstalk_preland.py`, `informed_red` from
 * `policy_beanstalk_v2.py`). Agent behaviour must not differ between a local and a cloud
 * race, so any change here is a change to the experiment: prompts keep the harness's words
 * ("trunk", "main") even where the gateway's API says sprout and stalk.
 */
import type { ArenaTask } from '@beanstalk/shared-race/task';
import { acceptancePaths } from '@beanstalk/shared-race/task';

export const NO_COMMIT = "Don't stage or commit; the harness commits your changes.";

type PromptTask = Pick<ArenaTask, 'title' | 'prompt' | 'acceptance_tests'>;

export function acceptanceLine(paths: readonly string[]): string {
  return (
    `Acceptance tests are in ${paths.join(', ')}. Make them pass without breaking other tests. ` +
    "Run `node --test`. Don't edit the acceptance tests. Keep changes minimal."
  );
}

export function initialPrompt(task: PromptTask): string {
  return `${task.title}\n\n${task.prompt.trim()}\n\n${acceptanceLine(acceptancePaths(task))} ${NO_COMMIT}\n`;
}

function sessionHead(task: PromptTask, resumed: boolean): string {
  return resumed ? '' : `You are working on: ${task.title}\n\n${task.prompt.trim()}\n\n`;
}

export function reworkConflictPrompt(
  task: PromptTask,
  files: readonly string[],
  target: string,
  resumed: boolean,
): string {
  return (
    `${sessionHead(task, resumed)}Your change could not be merged: ${target} moved on and conflicts with it. ` +
    `The merge of ${target} into your branch is in progress in this worktree; conflict markers are in: ` +
    `${files.join(', ')}.\n\nResolve every conflict so that your change and the changes already on ${target} ` +
    'both keep working, and remove all conflict markers. ' +
    `${acceptanceLine(acceptancePaths(task))} ${NO_COMMIT}\n`
  );
}

/** One conflict block shown to the author: the line's side and the bean's own. */
export type PromptHunk = { readonly path: string; readonly sprout: string; readonly bean: string };

/** A landed bean that wrote the other side of a conflicted file. */
export type ConflictAuthor = {
  readonly task: string;
  readonly title: string;
  readonly intent: string;
  readonly paths: readonly string[];
};

/** What v2's conflict rework knows beyond the files: the hunks and who wrote the other side. */
export type ConflictContext = {
  readonly files: readonly string[];
  readonly hunks: readonly PromptHunk[];
  readonly authors: readonly ConflictAuthor[];
};

/** Hunks a conflict prompt quotes. */
const PROMPT_HUNKS = 4;
/** Characters of each side of a quoted hunk, and of an author's intent. */
const PROMPT_SIDE_CHARS = 1200;
const PROMPT_INTENT_CHARS = 400;

/**
 * v2's conflict rework: `reworkConflictPrompt` plus both sides of each conflict block, the
 * landed beans that wrote the line's side with their intent, and an instruction to keep both
 * intents. Without hunks or authors it says no more than the harness's prompt.
 */
export function informedConflictPrompt(
  task: PromptTask,
  conflict: ConflictContext,
  resumed: boolean,
): string {
  const target = 'the trunk';
  const head =
    `${sessionHead(task, resumed)}Your change could not be merged: ${target} moved on and conflicts with it. ` +
    `The merge of ${target} into your branch is in progress in this worktree; conflict markers are in: ` +
    `${conflict.files.join(', ')}.\n\n`;
  return (
    head +
    hunkLines(conflict.hunks) +
    authorLines(conflict.authors) +
    `Resolve every conflict so that your change and the changes already on ${target} both keep working: ` +
    'keep both intents, never drop one side to make the merge compile, and remove all conflict markers. ' +
    `${acceptanceLine(acceptancePaths(task))} ${NO_COMMIT}\n`
  );
}

/** A bean that landed while another bean's agent worked (`live_sync`), and the files it met. */
export type SyncedBean = {
  readonly task: string;
  readonly title: string;
  readonly files: readonly string[];
};

function syncedLines(beans: readonly SyncedBean[]): string {
  return beans.map((bean) => `- ${bean.task} "${bean.title}"${filesSuffix(bean.files)}\n`).join('');
}

function filesSuffix(files: readonly string[]): string {
  return files.length === 0 ? '' : ` (${files.join(', ')})`;
}

/**
 * `live_sync` (beanstalk only, no harness counterpart): changes that landed while the agent
 * worked are merged into its branch; it re-runs the tests and fixes only what they broke.
 */
export function syncPrompt(
  task: PromptTask,
  beans: readonly SyncedBean[],
  resumed: boolean,
): string {
  return (
    `${sessionHead(task, resumed)}While you worked, these changes landed on the trunk and meet your work:\n` +
    syncedLines(beans) +
    '\nThe trunk is merged into your branch in this worktree (no conflicts). Run `node --test`. ' +
    'If the merged changes broke your change or theirs, fix it so that both keep working; ' +
    'otherwise change nothing. ' +
    `${acceptanceLine(acceptancePaths(task))} ${NO_COMMIT}\n`
  );
}

/** `live_sync`: the note a conflicting sync leaves at the top of the bean's next prompt. */
export function syncNote(beans: readonly SyncedBean[]): string {
  return `Note: while you worked, these changes landed on the trunk and touched your files:\n${syncedLines(beans)}\n`;
}

function hunkLines(hunks: readonly PromptHunk[]): string {
  if (hunks.length === 0) return '';
  const shown = hunks
    .slice(0, PROMPT_HUNKS)
    .map(
      (hunk) =>
        `${hunk.path}:\n\`\`\`\n<<<<<<< trunk\n${sideBlock(hunk.sprout)}` +
        `=======\n${sideBlock(hunk.bean)}>>>>>>> yours\n\`\`\`\n`,
    );
  const more =
    hunks.length > PROMPT_HUNKS ? `(${hunks.length - PROMPT_HUNKS} more in the files.)\n` : '';
  return `The conflicting hunks (the trunk's side, then yours):\n${shown.join('')}${more}\n`;
}

function authorLines(authors: readonly ConflictAuthor[]): string {
  if (authors.length === 0) return '';
  const lines = authors.map(
    (author) =>
      `- ${author.task} "${author.title}" (${author.paths.join(', ')}): ` +
      clip(author.intent.trim().replaceAll(/\s+/g, ' '), PROMPT_INTENT_CHARS),
  );
  return `The trunk's side was written by these landed changes:\n${lines.join('\n')}\n\n`;
}

function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

/** A hunk side as lines between markers: clipped, and ending with a newline unless empty. */
function sideBlock(side: string): string {
  const clipped = clip(side, PROMPT_SIDE_CHARS);
  return clipped === '' || clipped.endsWith('\n') ? clipped : `${clipped}\n`;
}

export function reworkRedPrompt(
  task: PromptTask,
  failing: readonly string[],
  output: string,
  target: string,
  resumed: boolean,
): string {
  const tests =
    failing.map((test) => `- ${test}`).join('\n') || '- (the suite failed; see the output)';
  return (
    `${sessionHead(task, resumed)}The merge queue rejected your change: merged with the latest ${target} and the other queued ` +
    `changes, these tests failed:\n${tests}\n\nOutput:\n\`\`\`\n${output.trim()}\n\`\`\`\n\n` +
    `The latest ${target} has been merged into this worktree. Fix your change so the whole suite passes ` +
    "(your acceptance tests and everyone else's). Other teams' acceptance tests describe behaviour that " +
    `must keep working. ${acceptanceLine(acceptancePaths(task))} ${NO_COMMIT}\n`
  );
}

/** A repair ticket as the beanstalk fixer prompt reads it. */
export type FixerTicket = {
  readonly id: string;
  readonly attempt: number;
  readonly failingTests: readonly string[];
  readonly output: string;
};

/** A suspect commit shown to a fixer. */
export type FixerSuspect = {
  readonly sha: string;
  readonly label: string;
  readonly title: string;
  readonly intent: string;
  readonly diff: string;
};

export function fixerPrompt(
  ticket: FixerTicket,
  suspects: readonly FixerSuspect[],
  acceptance: readonly string[],
): string {
  const failing = ticket.failingTests.map((test) => `- ${test}`);
  const lines = [
    `The fast trunk is red. Repair ticket ${ticket.id} (attempt ${ticket.attempt}).`,
    '',
    'Failing tests:',
    ...(failing.length > 0 ? failing : ['- (see output)']),
    '',
    'Output:',
    '```',
    ticket.output.trim(),
    '```',
    '',
    ...suspectLines(suspects),
    '',
    'Make the whole suite pass (`node --test`) with a minimal change that preserves the intent of ' +
      "every suspect change: don't revert features. Don't edit acceptance tests " +
      `(${acceptance.length > 0 ? acceptance.join(', ') : 'test files named in the tickets'}). ${NO_COMMIT}`,
  ];
  return `${lines.join('\n')}\n`;
}

function suspectLines(suspects: readonly FixerSuspect[]): string[] {
  if (suspects.length === 0) {
    return [
      'No suspect could be isolated; the failure appeared between the last green commit and the head.',
    ];
  }
  const header =
    'Suspect commits: unvalidated changes whose writes intersect what the failing tests read, plus any ' +
    "change that landed after a suspect's snapshot and wrote the same code (marked):";
  return [
    header,
    ...suspects.flatMap((suspect) => [
      `- ${suspect.sha.slice(0, 10)} ${suspect.label}: ${suspect.title}`,
      `  Intent: ${suspect.intent.trim()}`,
      '  Diff:',
      '```diff',
      suspect.diff.trim(),
      '```',
    ]),
  ];
}

export function prelandRedPrompt(
  task: PromptTask,
  failing: readonly string[],
  output: string,
  resumed: boolean,
): string {
  const tests =
    failing.map((test) => `- ${test}`).join('\n') || '- (the suite failed; see the output)';
  return (
    `${sessionHead(task, resumed)}Your change was not landed. Merged onto the latest trunk, these tests failed:\n${tests}\n\n` +
    `Output:\n\`\`\`\n${output.trim()}\n\`\`\`\n\n` +
    'The latest trunk has been merged into this worktree. Fix your change so the whole suite passes. ' +
    "Acceptance tests (yours and other teams') are protected: edits to them are discarded before landing, " +
    "so change the code, not the tests. Other teams' acceptance tests describe behaviour that must keep " +
    `working. ${acceptanceLine(acceptancePaths(task))} ${NO_COMMIT}\n`
  );
}

/** A landed change the informed rework names: what it was for and what it changed. */
export type CulpritContext = {
  readonly task: string;
  readonly title: string;
  readonly intent: string;
  readonly diff: string;
};

/** v2's `informed_red`: the failures plus the intent and diff of the landed changes involved. */
export function informedRedPrompt(
  task: PromptTask,
  failing: readonly string[],
  output: string,
  culprits: readonly CulpritContext[],
  resumed: boolean,
): string {
  const tests =
    failing.map((test) => `- ${test}`).join('\n') || '- (the suite failed; see the output)';
  const lines = [
    `${sessionHead(task, resumed)}Your change was not landed. Merged onto the latest trunk, these tests failed:`,
    tests,
    '',
    'Output:',
    '```',
    output.trim(),
    '```',
    '',
  ];
  if (culprits.length > 0) {
    lines.push(
      'They involve changes that already landed and are accepted behaviour. Their intent and diffs:',
    );
    for (const culprit of culprits) {
      lines.push(
        `- ${culprit.task}: ${culprit.title}`,
        `  Intent: ${culprit.intent.trim()}`,
        '  Diff:',
        '```diff',
        culprit.diff.trim(),
        '```',
      );
    }
    lines.push(
      '',
      'Adapt your change so that your acceptance tests AND theirs pass. Where the two behaviours ' +
        'seem to contradict, keep both by scoping your change (a separate helper, an explicit option, ' +
        'the new shape at the new call site) rather than changing their accepted behaviour.',
    );
  }
  lines.push(
    "The latest trunk has been merged into this worktree. Acceptance tests (yours and other teams') are " +
      'protected: edits to them are discarded before landing, so change the code, not the tests.',
    `${acceptanceLine(acceptancePaths(task))} ${NO_COMMIT}`,
  );
  return `${lines.join('\n')}\n`;
}

/** A product decision as the prompts state it (E6 `decision_block`). */
export type DecisionContext = {
  readonly card: string;
  readonly text: string;
  /** The oracle, a human, or the oracle after the human's timeout. */
  readonly by: 'oracle' | 'human' | 'human-timeout';
};

const DECIDED_BY: Readonly<Record<DecisionContext['by'], string>> = {
  oracle: 'decided by the product owner',
  human: 'decided by a human',
  'human-timeout': 'decided by the product owner (default)',
};

/** E6's `decision_text`: the decision line written when the human gave none. */
export function decisionText(
  winner: { readonly id: string; readonly title: string },
  loser: { readonly id: string; readonly title: string },
): string {
  return (
    `Where the two specs disagree, ${winner.id}'s behaviour stands: ${winner.title}. ` +
    `${loser.id} (${loser.title}) must work with it; its acceptance tests are amended where they ` +
    'encode the other behaviour.'
  );
}

function decisionBlock(
  decision: DecisionContext,
  winner: CulpritContext | null,
  me: string,
): string[] {
  const lines = [
    `Product decision ${decision.card} (${DECIDED_BY[decision.by]}): ${decision.text}`,
  ];
  if (winner === null || winner.task === me) return lines;
  return [
    ...lines,
    '',
    `${winner.task} "${winner.title}" is accepted behaviour on the trunk that your change must work with.`,
    `Its intent: ${winner.intent.trim()}`,
    'Its diff:',
    '```diff',
    winner.diff.trim(),
    '```',
  ];
}

function amendedLine(paths: readonly string[]): string[] {
  if (paths.length === 0) return [];
  return [
    `Your acceptance tests were amended by the test author to match the decision (${paths.join(', ')}). ` +
      'They are your spec now.',
    '',
  ];
}

function inForceLines(inForce: readonly string[]): string[] {
  if (inForce.length === 0) return [];
  return ['Other decisions in force for this task:', ...inForce.map((line) => `- ${line}`), ''];
}

/**
 * E6's `reexec_prompt` for a `keep-landed` loser: a fresh session on a fresh fork of the
 * sprout head, with the decision, the winner's intent and diff, and its amended tests.
 */
export function reexecutionPrompt(
  task: PromptTask & Pick<ArenaTask, 'id'>,
  decision: DecisionContext,
  context: {
    readonly winner: CulpritContext | null;
    readonly amended: readonly string[];
    readonly inForce: readonly string[];
  },
): string {
  const lines = [
    task.title,
    '',
    task.prompt.trim(),
    '',
    ...decisionBlock(decision, context.winner, task.id),
    '',
    'Your earlier attempt was discarded because it contradicted that accepted behaviour. ' +
      'Implement your task again on the current trunk, within the decision.',
    '',
    ...inForceLines(context.inForce),
    ...amendedLine(context.amended),
    `${acceptanceLine(acceptancePaths(task))} ${NO_COMMIT}`,
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * E6's `start_context` (v2.5 start cards): the initial prompt of a bean whose card was
 * decided before it started, as the loser (within the decision, with its amended tests) or as
 * the winner (its spec stands over the landed partner's tests).
 */
export function startDecisionPrompt(
  task: PromptTask & Pick<ArenaTask, 'id'>,
  decision: DecisionContext,
  context: {
    readonly winner: CulpritContext | null;
    readonly isWinner: boolean;
    readonly amended: readonly string[];
  },
): string {
  const reason = context.isWinner
    ? "Where the other task's accepted behaviour contradicts your spec, your spec wins: you do not " +
      'need to keep its tests that encode the old behaviour passing (they will be amended and that ' +
      'task re-executed after you land). Keep every other test passing.'
    : 'This decision was made before you started; implement your task within it.';
  const lines = [
    task.title,
    '',
    task.prompt.trim(),
    '',
    ...decisionBlock(decision, context.winner, task.id),
    '',
    reason,
    '',
    ...amendedLine(context.amended),
    `${acceptanceLine(acceptancePaths(task))} ${NO_COMMIT}`,
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * E6's `reexec_prompt` for a rescue (v2.5): the rework rounds ran out, so the bean starts over
 * in a fresh session on the current trunk, with the last merged tree's failures and every
 * decision in force on it.
 */
export function rescuePrompt(
  task: PromptTask & Pick<ArenaTask, 'id'>,
  context: {
    readonly failing: readonly string[];
    readonly inForce: readonly string[];
    readonly amended: readonly string[];
  },
): string {
  const failing =
    context.failing.length === 0
      ? []
      : ['The last merged tree failed these tests:', ...context.failing.map((test) => `- ${test}`)];
  const inForce =
    context.inForce.length === 0
      ? []
      : ['Other decisions in force for this task:', ...context.inForce.map((line) => `- ${line}`)];
  const extra = [...failing, ...inForce];
  const lines = [
    task.title,
    '',
    task.prompt.trim(),
    '',
    'Your earlier attempts could not be landed: the trunk kept moving and the merged tree failed ' +
      'or conflicted. They were discarded. Implement your task again on the current trunk.',
    '',
    ...(extra.length === 0 ? [] : [...extra, '']),
    ...amendedLine(context.amended),
    `${acceptanceLine(acceptancePaths(task))} ${NO_COMMIT}`,
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * The winner of an `adopt-in-place` decision (v2.2): the landed loser stays and its
 * acceptance tests were amended to the decision; the winner's session lands with them.
 */
export function adoptInPlacePrompt(
  task: PromptTask & Pick<ArenaTask, 'id'>,
  decision: DecisionContext,
  context: {
    readonly loser: { readonly id: string; readonly title: string };
    readonly amended: readonly string[];
    readonly inForce: readonly string[];
    readonly resumed: boolean;
  },
): string {
  const { loser } = context;
  const amendment =
    context.amended.length > 0
      ? `${loser.id}'s acceptance tests were amended to the decision (${context.amended.join(', ')}). ` +
        'The amendment is merged into this worktree and lands with your change; the tests are ' +
        'protected, so edits to them are discarded before landing.'
      : `The test author found nothing in ${loser.id}'s acceptance tests that contradicts the decision.`;
  const lines = [
    `${sessionHead(task, context.resumed)}${decisionBlock(decision, null, task.id).join('\n')}`,
    '',
    `Your spec wins over ${loser.id} ("${loser.title}"), which stays on the trunk. ${amendment}`,
    '',
    `Make your acceptance tests and everyone else's pass, adapting ${loser.id}'s code where it ` +
      'must follow your behaviour.',
    '',
    ...inForceLines(context.inForce),
    `${acceptanceLine(acceptancePaths(task))} ${NO_COMMIT}`,
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * E6's `author_prompt`: a separate session that amends the loser's acceptance tests to the
 * decided spec, or replies NO AMENDMENT. On the loser's snapshot (keep-landed) the amended
 * tests must still fail; in place, the loser is implemented and only the decision changes.
 */
export function testAuthorPrompt(
  loser: PromptTask & Pick<ArenaTask, 'id'>,
  decision: Pick<DecisionContext, 'card' | 'text'>,
  context: {
    readonly winner: CulpritContext;
    readonly failing: readonly string[];
    readonly output: string;
    readonly inForce: readonly string[];
    readonly inPlace: boolean;
    /** v2.4: the winner's failing tests as they are now, by path. */
    readonly winnerTests?: Readonly<Record<string, string>>;
  },
): string {
  const paths = acceptancePaths(loser);
  const { winner } = context;
  const lines = [
    `You are the test author for task ${loser.id}. You write and amend acceptance tests; you never implement features.`,
    '',
    `A product decision was made (${decision.card}): ${decision.text}`,
    '',
  ];
  if (context.inForce.length > 0) {
    lines.push(
      `Earlier decisions about ${loser.id} are still in force; the tests must stay consistent with them too ` +
        '(keep what they decided, change only what this new decision changes):',
      ...context.inForce.map((line) => `- ${line}`),
      '',
    );
  }
  lines.push(
    `Task ${loser.id} ("${loser.title}") was specified as:`,
    loser.prompt.trim(),
    '',
    `Its acceptance tests are in: ${paths.join(', ')}. They were written before this decision.`,
    '',
    context.inPlace
      ? `The winning change, ${winner.task} ("${winner.title}"), lands next; it is not in this tree yet.`
      : `The winning change, ${winner.task} ("${winner.title}"), is already in this tree.`,
    `Its intent: ${winner.intent.trim()}`,
    'Its diff:',
    '```diff',
    winner.diff.trim(),
    '```',
  );
  if (context.failing.length > 0) {
    lines.push(
      '',
      `When ${loser.id}'s implementation met it, these tests failed:`,
      ...context.failing.slice(0, AUTHOR_FAILING_TESTS).map((test) => `- ${test}`),
    );
    if (context.output.trim() !== '') {
      lines.push('Output:', '```', context.output.trim().slice(0, AUTHOR_OUTPUT_CHARS), '```');
    }
  }
  lines.push(
    ...testFiles(`The failing tests of ${winner.task}, as they are now:`, context.winnerTests),
  );
  const check = context.inPlace
    ? `${loser.id} is implemented in this tree; the amended tests must describe the decided behaviour, ` +
      'which the winning change brings when it lands. Run ' +
      `\`node --test ${paths.join(' ')}\` to check that they parse.`
    : `${loser.id} is not implemented in this tree, so its tests must still fail here because the ` +
      `feature is missing: run \`node --test ${paths.join(' ')}\` to check that they fail for that ` +
      'reason and not because of a syntax error.';
  lines.push(
    '',
    `Amend ${loser.id}'s acceptance tests so that they encode the decided behaviour: change only the ` +
      'assertions (and the setup they need) that contradict the decision, keep every other assertion and ' +
      'the file structure, and do not edit any other file. Work out expected values from the code in this ' +
      `tree. ${check} If the tests encode nothing that contradicts the decision, change nothing and reply ` +
      "NO AMENDMENT. Don't stage or commit.",
  );
  return `${lines.join('\n')}\n`;
}

/**
 * v2.4: before a decision card, a test author reconciles the two tasks' acceptance tests on
 * the arriving bean's branch: an assertion that pins a value the other intent legitimately
 * changes is updated (RECONCILED); a genuine disagreement changes nothing (CONTRADICTION).
 * v2.5: every landed party behind the failing tests takes part (the counterpart first); with
 * one, the prompt is v2.4's. The tree is the arriving bean's branch with the landed line merged
 * in, so every party's code is there (the prompt says so).
 */
export function reconcilePrompt(
  arriving: PromptTask & Pick<ArenaTask, 'id'>,
  landed: readonly (PromptTask & Pick<ArenaTask, 'id'>)[],
  context: {
    readonly failing: readonly string[];
    readonly output: string;
    /** The failing tests of the tasks as they are now, by path. */
    readonly tests: Readonly<Record<string, string>>;
    /** Every acceptance test file of the tasks: the only files it may change. */
    readonly paths: readonly string[];
  },
): string {
  const isPair = landed.length <= 1;
  const ids = [arriving.id, ...landed.map((task) => task.id)];
  const lines = [
    `You are the test author for tasks ${listed(ids)}. You write and amend acceptance tests; you never implement features.`,
    '',
    `This tree is ${arriving.id}'s branch with the landed line merged in (the sprout its pre-land check ran on): ` +
      `it holds ${arriving.id}'s change and the code of ${isPair ? 'the landed task' : 'every landed task'} below.`,
    '',
    `Task ${arriving.id} ("${arriving.title}") is arriving; its change is in this tree:`,
    arriving.prompt.trim(),
    ...landed.flatMap((task) => [
      '',
      `Task ${task.id} ("${task.title}") has already landed:`,
      task.prompt.trim(),
    ]),
    '',
    isPair
      ? 'With both in this tree, these tests fail:'
      : 'With all of them in this tree, these tests fail:',
    ...context.failing.slice(0, AUTHOR_FAILING_TESTS).map((test) => `- ${test}`),
  ];
  if (context.output.trim() !== '') {
    lines.push('Output:', '```', context.output.trim().slice(0, AUTHOR_OUTPUT_CHARS), '```');
  }
  const other = isPair ? 'the other task' : 'another of these tasks';
  const othersIntent = isPair ? "the other task's" : "another task's";
  lines.push(
    ...testFiles('The failing tests, as they are now:', context.tests),
    '',
    `${isPair ? 'Do the two intents contradict?' : 'Do the intents contradict?'} Often they do not: a test pins a value that ${other} ` +
      'legitimately changes (an example total, a formatted string), and only that value is out of date.' +
      (isPair
        ? ''
        : " One failing test can clash with more than one landed task: check each landed task's rule before you decide."),
    `- If they do not, update in ${context.paths.join(', ')} only the assertions that pin such a value, ` +
      "so that each task's own intent stays tested. Work out the new expected values from the code in " +
      `this tree, run \`node --test ${context.paths.join(' ')}\` until they pass, and reply RECONCILED.`,
    `- Change a value only when ${othersIntent} intent explains the new one, and say which in your reply. ` +
      "Never delete or loosen an assertion, and never change what a task's own intent requires: if the code " +
      'looks wrong rather than the test, change nothing and reply CONTRADICTION: <what looks wrong>.',
    isPair
      ? '- If both cannot hold, change nothing and reply with one line: CONTRADICTION: <the disagreement>.'
      : '- If they cannot all hold, change nothing and reply with one line: CONTRADICTION: <the disagreement, naming the tasks>.',
    "Don't stage or commit.",
  );
  return `${lines.join('\n')}\n`;
}

/** `a and b`, `a, b and c`. */
function listed(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;
}

/** Test files shown to a test author, under a heading (nothing when there are none). */
function testFiles(heading: string, files: Readonly<Record<string, string>> | undefined): string[] {
  const entries = Object.entries(files ?? {});
  if (entries.length === 0) return [];
  return [
    '',
    heading,
    ...entries.flatMap(([path, content]) => [
      `${path}:`,
      '```ts',
      content.trimEnd().slice(0, AUTHOR_TEST_CHARS),
      '```',
    ]),
  ];
}

/** Characters of one test file a test author is shown. */
const AUTHOR_TEST_CHARS = 6000;

/** Failing tests and output characters a test author is shown (`[:12]`, `[:3000]`). */
const AUTHOR_FAILING_TESTS = 12;
const AUTHOR_OUTPUT_CHARS = 3000;

/** Extra line `rework_flow` appends to a red prompt when the merge of main also conflicted. */
export function alsoConflictedLine(files: readonly string[]): string {
  return `\nThe merge of main also left conflict markers in: ${files.join(', ')}. Resolve them too.\n`;
}

/** The harness's commit message for agent work (`commit_task`). */
export function taskCommitMessage(
  task: Pick<ArenaTask, 'title' | 'id'>,
  kind: string,
  inv: string,
): string {
  return `${task.title}\n\nTask: ${task.id}\nKind: ${kind}\nInvocation: ${inv}\n`;
}

/** The queue's squash message (`QueueRace.land_message`). */
export function queueLandMessage(task: Pick<ArenaTask, 'title' | 'id'>): string {
  return `${task.title}\n\nTask: ${task.id}\nPolicy: queue\n`;
}

/**
 * v2.5 (`tests_first`; E1's `test_author`, verbatim): a separate session writes a task's
 * acceptance tests from its intent alone, before anyone implements it. Only new test files
 * are kept, and they must fail on the task's base.
 */
export function testsFirstPrompt(task: Pick<ArenaTask, 'title' | 'prompt'>): string {
  return (
    'You write the acceptance tests for an issue before anyone implements it. Another engineer will implement ' +
    'the issue later, in a separate session, against your tests: they will not see your reasoning and cannot ' +
    `change your tests.\n\nIssue: ${task.title}\n\n${task.prompt.trim()}\n\n` +
    'Add one new test file (node:test, `*.test.ts`) next to the code the issue is about, in the style of the ' +
    'existing tests and using their helpers (for example src/lib/testing.ts). Test the behaviour the issue asks ' +
    "for through the names it gives (functions, fields, routes, messages, statuses); don't assume other names or " +
    'internal details. The tests must fail on the current code because the behaviour is missing, and pass once ' +
    'the issue is implemented correctly. Run `node --test <your file>` to check that the file loads and fails ' +
    'for that reason (a failed assertion or the missing export, not a mistake in the test).\n\n' +
    "Don't implement the issue and don't change existing files: only new test files are kept, so any helper " +
    "must live inside your test file. Don't stage or commit; the harness collects your file.\n"
  );
}

/** The beanstalk policies' squash message for a task (`BeanstalkRace.land_message`). */
export function beanstalkLandMessage(task: Pick<ArenaTask, 'title' | 'id'>): string {
  return `${task.title}\n\nTask: ${task.id}\nPolicy: beanstalk\n`;
}

/** The message of a revert on the landed line (`revert_culprit`); `ticket` may be a card. */
export function revertMessage(title: string, reverted: string, ticket: string): string {
  return `Revert ${title}\n\nReverts: ${reverted}\nTicket: ${ticket}\n`;
}

/** The message of a red-window reset (`red_reset`): the sprout back to the stalk's tree. */
export function resetMessage(green: string, head: string, ticket: string): string {
  return `Reset the sprout to ${green.slice(0, 10)}\n\nReverts: ${green}..${head}\nTicket: ${ticket}\n`;
}

/** The message of a leave-one-out probe commit (`leave_one_out`). */
export function probeMessage(without: string): string {
  return `probe: without ${without.slice(0, 10)}\n`;
}
