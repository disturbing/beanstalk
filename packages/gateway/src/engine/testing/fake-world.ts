/**
 * A scripted world for engine tests: a fake runner (squash, revert, check, update-ref,
 * diff, line ranges, file reads) and fake agents (initial, rework, re-execution and test
 * author invocations) over one toy git object store. Tasks write files carrying markers; a
 * failure rule turns the suite red while all of its markers are present (one marker: a bug;
 * two: a semantic clash), unless its test file says otherwise. A task's acceptance test
 * (`tests/<id>.test.ts`) passes only while some file carries `impl:<id>`; a test file that
 * contains `SYNTAX ERROR` fails as unparsable. Flaky failures can be injected per suite run.
 */
import type { InvocationResult } from '@gitstalk/shared-race/driver';
import type { Sha } from '@gitstalk/shared-race/ids';

import { assertNever } from '../errors';
import { changedRanges, diffText } from '../../git/diff-text';
import type {
  CheckInstance,
  CheckResult,
  EngineInstruction,
  FailingTest,
  JobOutcome,
  JobSpec,
} from '../model';
import { probeMessage } from '../prompts';
import { SPROUT_REF, STALK_REF } from '../refs';
import type { Files, ToyGit } from './toy-git';
import { changedPaths, createToyGit, hasMarkers, mergeFiles, resolveBothSides } from './toy-git';

/** A failing test that fails while every marker appears in some file of the tree. */
export type FailRule = {
  readonly markers: readonly string[];
  readonly file: string;
  readonly name: string;
  /** Source files the failing test imports (its read set, one hop away). */
  readonly reads?: readonly string[];
  /** The rule does not fire while the failing test file contains this (an amended test). */
  readonly unless?: string;
  /** The rule fires only while the failing test file contains this (a test that pins the behaviour). */
  readonly onlyIf?: string;
  /** The rule fires only while its test file exists (a new test failing with the whole suite). */
  readonly requiresFile?: boolean;
};

/** A flaky failure to inject into one suite run (`nth` counts the runs of a commit from 1). */
export type FlakeInjector = (run: {
  readonly sha: Sha;
  readonly instance: CheckInstance;
  readonly nth: number;
}) => FailingTest | null;

export type ScriptedTask = {
  readonly id: string;
  /** Files the initial run writes, by path. Write `BUG:<id>` where the change is wrong. */
  readonly writes: Readonly<Record<string, string>>;
  /**
   * Lines the initial run appends to files of its base, by path: two tasks appending to one
   * file from the same base conflict; one started after the other landed does not.
   */
  readonly appends?: Readonly<Record<string, string>>;
  /** Initial runs that fail to start (infra errors) before one succeeds. */
  readonly flakyInitialRuns?: number;
  /** The agent never fixes its bug and never resolves conflict markers. */
  readonly stubborn?: boolean;
  /** A replay agent that cannot resolve its rework (`subtype: unresolved`). */
  readonly unresolvable?: boolean;
  /** Resuming this task's session fails to start (the driver's session store lost it). */
  readonly failsResume?: boolean;
  /** The runner cannot squash this task's bean (a permanent infrastructure failure). */
  readonly squashFails?: boolean;
  /**
   * Reverting this bean's landing conflicts (a later bean edited the lines it added, as t007
   * did after t010's migration in cf-demo-sonnet-30-s7). Leave-one-out probes conflict too.
   */
  readonly revertConflicts?: boolean;
  /**
   * Markers this bean's agent repairs wherever its tree has them: in its base, for its initial
   * run, and in the merged tree of its reworks (t026 renumbering the migrations; a migration's
   * author told its migration collides).
   */
  readonly fixes?: readonly string[];
  /** The runner's structural tier merged this bean: its clean squashes say so. */
  readonly mergesStructurally?: boolean;
  /** What a test author writes into this task's acceptance tests when it loses a card. */
  readonly amendTests?: Readonly<Record<string, string>>;
  /** Files the n-th re-execution writes (default: the initial writes with the bug fixed). */
  readonly reexecutions?: readonly Readonly<Record<string, string>>[];
  /**
   * v2.4: what a reconciling test author writes on this (arriving) task's branch, in the
   * acceptance tests of the tasks in the reconcile. Absent, or naming a test outside them (a
   * clash with a task it was not shown): it finds a contradiction and changes nothing.
   */
  readonly reconcile?: Readonly<Record<string, string>>;
  /** Reconciling test authors on this task's branch that crash (infra errors) before one runs. */
  readonly reconcileFails?: number;
  /** v2.5: tasks this one declares a semantic coupling with (the arena's `couplings`). */
  readonly coupledWith?: readonly string[];
  /**
   * v2.5: what a tests-first author writes for this task. Default: `tests/<id>.test.ts`, which
   * fails until the task is implemented. A test file containing `VACUOUS` asserts nothing.
   */
  readonly authorTests?: Readonly<Record<string, string>>;
};

export type WorldOptions = {
  readonly baseFiles: Readonly<Record<string, string>>;
  readonly tasks: readonly ScriptedTask[];
  readonly rules: readonly FailRule[];
  readonly costUsd?: number;
  readonly flakes?: FlakeInjector;
  /**
   * `live_sync` upper bound: an agent whose sync turn merged a tree that breaks a rule naming
   * its own clash marker rewrites its change as its first re-execution does (as if it saw the
   * test fail and adapted). Replay agents otherwise never adapt to synced code.
   */
  readonly adaptsOnSync?: boolean;
  /**
   * Emulated seconds a dynamic-culprit probe's suite adds in the bean's sandbox: the real race's
   * probes cost about a pre-land check each (`cf-demo2-sonnet-30-s7`: 2.5 to 3.7 minutes per
   * search of 6). Pre-land checks and proofs get their latency from the engine's timers, and
   * CI-slot runs from `ci_seconds`, so only probes are charged here. Absent: 0.
   */
  readonly probeLatencySeconds?: number;
};

export type World = {
  readonly git: ToyGit;
  readonly baseSha: Sha;
  /** Every instruction an agent received, in order. */
  readonly instructions: readonly EngineInstruction[];
  /** Every job the runner received, in order. */
  readonly jobs: readonly JobSpec[];
  /** Where a ref of the run repo points (`refs/heads/sprout`, `refs/heads/stalk`). */
  repoRef(ref: string): Sha | undefined;
  runJob(spec: JobSpec): JobOutcome;
  runAgent(instruction: EngineInstruction): InvocationResult;
  /** Runner and agent durations, in milliseconds. */
  jobMillis(spec: JobSpec): number;
};

/** The run repo of the toy world (the sprout and the stalk live here). */
const REPO = 'repo';
/** How a dynamic-culprit probe's revert commit message starts. */
const PROBE_MESSAGE = probeMessage('').trimEnd();
/** Seconds the fake suite reports; the engine adds `ci_seconds` of emulated latency. */
const SUITE_SECONDS = 1.5;

export function createWorld(options: WorldOptions): World {
  const git = createToyGit();
  const base = git.commit([], new Map(Object.entries(options.baseFiles)), 'base');
  git.setRef(REPO, SPROUT_REF, base.sha);
  git.setRef(REPO, STALK_REF, base.sha);
  const scripted = new Map(options.tasks.map((task) => [task.id, task]));
  const worktrees = new Map<string, { files: Files; parents: readonly Sha[] }>();
  const instructions: EngineInstruction[] = [];
  const jobs: JobSpec[] = [];
  const checkRuns = new Map<string, number>();
  /** Squashed candidates by sha: the bean each one lands. */
  const squashedBy = new Map<string, string>();
  const reexecutions = new Map<string, number>();
  const reconcileFailures = new Map<string, number>();
  const probeMillis = (options.probeLatencySeconds ?? 0) * 1000;
  return {
    git,
    baseSha: base.sha,
    instructions,
    jobs,
    repoRef: (ref) => git.ref(REPO, ref),
    runJob: (spec) => {
      jobs.push(spec);
      if (spec.kind === 'squash' && scripted.get(spec.changeKey)?.squashFails === true) {
        return { ok: false, error: 'runner exploded', retryable: false };
      }
      if (spec.kind === 'check') {
        const nth = (checkRuns.get(spec.sha) ?? 0) + 1;
        checkRuns.set(spec.sha, nth);
        const flake = options.flakes?.({ sha: spec.sha, instance: spec.instance, nth }) ?? null;
        const result = check(git, options.rules, { ...spec, flake });
        return { ok: true, result: { kind: 'check', check: result } };
      }
      if (
        spec.kind === 'revert' &&
        spec.to === undefined &&
        scripted.get(squashedBy.get(spec.commit) ?? '')?.revertConflicts
      ) {
        const files = changedPaths(
          git.get(git.get(spec.commit).parents[0] ?? spec.commit).files,
          git.get(spec.commit).files,
        );
        return { ok: true, result: { kind: 'revert', outcome: 'conflict', files } };
      }
      const outcome = runJob(git, options.rules, spec);
      if (
        spec.kind === 'squash' &&
        outcome.ok &&
        outcome.result.kind === 'squash' &&
        outcome.result.outcome === 'clean'
      ) {
        squashedBy.set(outcome.result.sha, spec.changeKey);
      }
      const isStructural =
        spec.kind === 'squash' &&
        spec.structural &&
        scripted.get(spec.changeKey)?.mergesStructurally === true;
      return isStructural ? structurally(outcome) : outcome;
    },
    runAgent: (instruction) => {
      instructions.push(instruction);
      const task = scripted.get(instruction.task);
      if (task === undefined) throw new Error(`no script for ${instruction.task}`);
      if (task.failsResume === true && instruction.resume !== null) {
        return agentResult({
          ok: false,
          infra_error: 'No conversation found with session ID',
          cost_source: 'none',
        });
      }
      const costUsd = options.costUsd ?? 0;
      if (instruction.kind === 'initial') return initialRun(git, task, instruction, costUsd);
      if (instruction.kind === 'test-author') return authorRun(git, task, instruction);
      if (instruction.kind === 'test-first') return testsFirstRun(git, task, instruction);
      if (instruction.kind === 'reconcile') {
        const failures = reconcileFailures.get(task.id) ?? 0;
        if (failures < (task.reconcileFails ?? 0)) {
          reconcileFailures.set(task.id, failures + 1);
          return agentResult({ ok: false, infra_error: 'agent crashed', cost_source: 'none' });
        }
        return reconcileRun(git, task, instruction);
      }
      if (instruction.workspace.headSha === null) {
        const nth = (reexecutions.get(task.id) ?? 0) + 1;
        reexecutions.set(task.id, nth);
        const writes = task.reexecutions?.[nth - 1] ?? fixedWrites(task);
        return freshRun(git, { task, writes, costUsd }, instruction);
      }
      const adapts = instruction.kind === 'sync' && options.adaptsOnSync === true;
      return reworkRun(
        { git, worktrees, task, costUsd, adaptTo: adapts ? options.rules : [] },
        instruction,
      );
    },
    jobMillis: (spec) =>
      JOB_MILLIS[spec.kind] + (probeMillis > 0 && isProbeCheck(git, spec) ? probeMillis : 0),
  };
}

const JOB_MILLIS: Record<JobSpec['kind'], number> = {
  squash: 300,
  revert: 300,
  check: SUITE_SECONDS * 1000,
  diff: 100,
  'update-ref': 200,
  'read-files': 100,
  'line-ranges': 100,
};

/** A suite in a bean's sandbox on a dynamic-culprit probe's tree (the revert's message says so). */
function isProbeCheck(git: ToyGit, spec: JobSpec): boolean {
  return (
    spec.kind === 'check' &&
    spec.instance.kind === 'sandbox' &&
    git.get(spec.sha).message.startsWith(PROBE_MESSAGE)
  );
}

/** A clean squash as the runner reports one its structural tier merged. */
function structurally(outcome: JobOutcome): JobOutcome {
  if (!outcome.ok || outcome.result.kind !== 'squash' || outcome.result.outcome !== 'clean') {
    return outcome;
  }
  return { ok: true, result: { ...outcome.result, resolved: 'structural' } };
}

function runJob(git: ToyGit, rules: readonly FailRule[], spec: JobSpec): JobOutcome {
  switch (spec.kind) {
    case 'squash':
      return squash(git, spec);
    case 'revert':
      return revert(git, spec);
    case 'diff':
      return { ok: true, result: { kind: 'diff', text: diff(git, spec) } };
    case 'check':
      return {
        ok: true,
        result: { kind: 'check', check: check(git, rules, { ...spec, flake: null }) },
      };
    case 'line-ranges':
      return {
        ok: true,
        result: {
          kind: 'line-ranges',
          mine: lineRanges(git, spec.base, spec.mine, spec.files),
          theirs: lineRanges(git, spec.base, spec.theirs, spec.files),
        },
      };
    case 'update-ref':
      return updateRef(git, spec.ref, spec.newSha, spec.oldSha);
    case 'read-files': {
      const contents = spec.reads.map(({ ref, path }) => git.get(ref).files.get(path) ?? null);
      return { ok: true, result: { kind: 'read-files', contents } };
    }
    default:
      return assertNever(spec);
  }
}

function squash(git: ToyGit, spec: Extract<JobSpec, { kind: 'squash' }>): JobOutcome {
  const head = git.ref(REPO, spec.changeRef);
  if (head === undefined) throw new Error(`${spec.changeKey} has no ${spec.changeRef}`);
  const mergeBase = git.mergeBase(head, spec.onto);
  if (mergeBase !== spec.changeBase) {
    throw new Error(
      `engine squashed ${spec.changeKey} with base ${spec.changeBase}; git says ${mergeBase}`,
    );
  }
  const onto = git.get(spec.onto);
  const merged = mergeFiles(
    git.get(spec.changeBase).files,
    onto.files,
    git.get(head).files,
    spec.unionPaths,
  );
  if (merged.kind === 'conflict') {
    return {
      ok: true,
      result: { kind: 'squash', outcome: 'conflict', files: merged.conflicts, hunks: [] },
    };
  }
  const commit = git.commit([onto.sha], merged.files, spec.message);
  git.setRef(REPO, `refs/beanstalk/candidates/${commit.sha}`, commit.sha);
  return {
    ok: true,
    result: {
      kind: 'squash',
      outcome: 'clean',
      sha: commit.sha,
      files: changedPaths(onto.files, commit.files),
      changeFiles: changedPaths(git.get(spec.changeBase).files, git.get(head).files),
      resolved: 'textual',
    },
  };
}

/** `merge_tree(commit, onto, parent)`: undo a commit on top of `onto` (`revert_culprit`). */
function revert(git: ToyGit, spec: Extract<JobSpec, { kind: 'revert' }>): JobOutcome {
  const target = git.get(spec.commit);
  const parent = spec.to ?? target.parents[0];
  if (parent === undefined) throw new Error(`cannot revert the root commit ${spec.commit}`);
  const onto = git.get(spec.onto);
  const merged = mergeFiles(target.files, onto.files, git.get(parent).files, spec.unionPaths);
  if (merged.kind === 'conflict') {
    return { ok: true, result: { kind: 'revert', outcome: 'conflict', files: merged.conflicts } };
  }
  const commit = git.commit([onto.sha], merged.files, spec.message);
  git.setRef(REPO, `refs/beanstalk/candidates/${commit.sha}`, commit.sha);
  return {
    ok: true,
    result: {
      kind: 'revert',
      outcome: 'clean',
      sha: commit.sha,
      files: changedPaths(onto.files, commit.files),
    },
  };
}

function diff(git: ToyGit, spec: Extract<JobSpec, { kind: 'diff' }>): string {
  const before = git.get(spec.parent).files;
  const after = git.get(spec.sha).files;
  const changes = changedPaths(before, after).map((path) => ({
    path,
    before: before.get(path) ?? null,
    after: after.get(path) ?? null,
    beforeId: null,
    afterId: null,
  }));
  return diffText(changes, spec.limit);
}

function lineRanges(
  git: ToyGit,
  base: Sha,
  sha: Sha,
  files: readonly string[],
): Record<string, [number, number][]> {
  const before = git.get(base).files;
  const after = git.get(sha).files;
  return Object.fromEntries(
    files.map((path) => [path, changedRanges(before.get(path) ?? null, after.get(path) ?? null)]),
  );
}

function check(
  git: ToyGit,
  rules: readonly FailRule[],
  run: {
    sha: Sha;
    extraFiles: Readonly<Record<string, string>> | null;
    flake: FailingTest | null;
    only?: readonly string[];
    allReadSets?: true;
  },
): CheckResult {
  const files = new Map(git.get(run.sha).files);
  for (const [path, content] of Object.entries(run.extraFiles ?? {})) files.set(path, content);
  const contents = [...files.values()];
  const isPresent = (marker: string): boolean => contents.some((text) => text.includes(marker));
  const testOf = (path: string): string => files.get(path) ?? '';
  const only = run.only === undefined ? null : new Set(run.only);
  const testFiles = [...files.keys()].filter(
    (path) => path.endsWith('.test.ts') && (only === null || only.has(path)),
  );
  const unparsable = testFiles.filter((path) => testOf(path).includes('SYNTAX ERROR'));
  const missingFeatures = testFiles.flatMap((path) => {
    const id = /^tests\/(.+)\.test\.ts$/.exec(path)?.[1];
    return id === undefined ||
      isPresent(`impl:${id}`) ||
      unparsable.includes(path) ||
      testOf(path).includes('VACUOUS')
      ? []
      : [{ file: path, name: `${id} is implemented` }];
  });
  const broken = rules.filter(
    (rule) =>
      (only === null || only.has(rule.file)) &&
      rule.markers.every(isPresent) &&
      (rule.unless === undefined || !testOf(rule.file).includes(rule.unless)) &&
      (rule.onlyIf === undefined || testOf(rule.file).includes(rule.onlyIf)) &&
      (rule.requiresFile !== true || files.has(rule.file)),
  );
  const failingTests: FailingTest[] = [
    ...broken.map((rule) => ({ file: rule.file, name: rule.name })),
    ...missingFeatures,
    ...unparsable.map((path) => ({
      file: path,
      name: path,
      message: 'SyntaxError: Unexpected identifier',
    })),
    ...(run.flake === null ? [] : [run.flake]),
  ];
  const failingFiles = [...new Set(failingTests.map((test) => test.file))].toSorted();
  const readSets = Object.fromEntries(
    broken.map((rule) => [rule.file, [rule.file, ...(rule.reads ?? [])]]),
  );
  const readDepths = Object.fromEntries(
    broken.map((rule) => [
      rule.file,
      Object.fromEntries([[rule.file, 0], ...(rule.reads ?? []).map((path) => [path, 1])]),
    ]),
  );
  const passingFiles = testFiles.filter((path) => !failingFiles.includes(path)).toSorted();
  return {
    green: failingTests.length === 0,
    tests: testFiles.length,
    failures: failingTests.length,
    failingTests,
    failingFiles,
    passingFiles,
    readSet: [...new Set(Object.values(readSets).flat())].toSorted(),
    readSets,
    // The fake suite's read sets are its rules' `reads`: complete by construction, unless a
    // scenario plants a rule whose markers live in a file its `reads` omit.
    ...(run.allReadSets === true
      ? { passingReadSets: passingReadSets(rules, passingFiles), readSetsComplete: true }
      : {}),
    readDepths,
    stackFiles: [],
    output:
      failingTests.length === 0
        ? 'ok'
        : `failing tests:\n${failingTests.map((test) => test.name).join('\n')}`,
    suiteSeconds: SUITE_SECONDS,
    timedOut: false,
  };
}

/**
 * A passing test reads what its failure rules name; a task's own test (`tests/<id>.test.ts`)
 * also reads its module.
 */
function passingReadSets(
  rules: readonly FailRule[],
  passingFiles: readonly string[],
): Record<string, string[]> {
  return Object.fromEntries(
    passingFiles.map((path) => {
      const id = /^tests\/(.+)\.test\.ts$/.exec(path)?.[1];
      const reads = rules.filter((rule) => rule.file === path).flatMap((rule) => rule.reads ?? []);
      const own = id === undefined ? [] : [`src/${id}/index.ts`];
      return [path, [...new Set([path, ...own, ...reads])].toSorted()];
    }),
  );
}

function updateRef(git: ToyGit, ref: string, newSha: Sha, oldSha: Sha): JobOutcome {
  const current = git.ref(REPO, ref);
  if (current !== oldSha && current !== newSha) {
    return { ok: true, result: { kind: 'update-ref', ok: false, actual: current ?? null } };
  }
  git.setRef(REPO, ref, newSha);
  return { ok: true, result: { kind: 'update-ref', ok: true, actual: null } };
}

function initialRun(
  git: ToyGit,
  task: ScriptedTask,
  instruction: EngineInstruction,
  costUsd: number,
): InvocationResult {
  if ((task.flakyInitialRuns ?? 0) >= instruction.attempt) {
    return agentResult({ ok: false, infra_error: 'exit 1 without a result', cost_source: 'none' });
  }
  const workspace = instruction.workspace;
  const base = git.get(workspace.baseSha);
  const files = new Map(base.files);
  repairForward(files, task);
  for (const [path, content] of Object.entries(workspace.acceptance)) files.set(path, content);
  for (const [path, content] of Object.entries(task.writes)) files.set(path, content);
  for (const [path, line] of Object.entries(task.appends ?? {})) {
    files.set(path, `${base.files.get(path) ?? ''}${line}\n`);
  }
  const commit = git.commit([base.sha], files, workspace.commitMessage);
  git.setRef(REPO, `refs/heads/${workspace.branch}`, commit.sha);
  return agentResult({
    ok: true,
    cost_usd: costUsd,
    session_id: `session-${task.id}`,
    head_sha: commit.sha,
    new_commit: true,
    files: changedPaths(base.files, files),
    pushed_ref: `refs/heads/${workspace.branch}`,
  });
}

/** A test author for the card's loser: the loser's tests as `amendTests` has them. */
function authorRun(
  git: ToyGit,
  task: ScriptedTask,
  instruction: EngineInstruction,
): InvocationResult {
  return freshRun(
    git,
    { task, writes: task.amendTests ?? {}, costUsd: 0.005, session: `author-${task.id}` },
    instruction,
  );
}

/** A tests-first author: `authorTests`, or the task's own test file, committed onto the base. */
function testsFirstRun(
  git: ToyGit,
  task: ScriptedTask,
  instruction: EngineInstruction,
): InvocationResult {
  const writes = task.authorTests ?? {
    [`tests/${task.id}.test.ts`]: `test('${task.id}'); // written first\n`,
  };
  return freshRun(
    git,
    { task, writes, costUsd: 0.005, session: `tests-first-${task.id}` },
    instruction,
  );
}

/**
 * A reconcile as the driver runs it: the bean's head with the landed line merged in, the
 * scripted amendments, and a commit (the merge alone when the author changed nothing).
 */
function reconcileRun(
  git: ToyGit,
  task: ScriptedTask,
  instruction: EngineInstruction,
): InvocationResult {
  const workspace = instruction.workspace;
  const branchHead = workspace.headSha ?? workspace.baseSha;
  const tree = mergeIntoWorktree(
    git,
    branchHead,
    workspace.merge?.sha ?? null,
    workspace.unionPaths,
  );
  const head =
    tree.parents.length > 1
      ? git.commit(tree.parents, tree.files, workspace.commitMessage).sha
      : branchHead;
  if (head !== branchHead) git.setRef(REPO, `refs/heads/${workspace.branch}`, head);
  const result = {
    ok: true,
    cost_usd: 0.005,
    session_id: `reconcile-${task.id}`,
    pushed_ref: `refs/heads/${workspace.branch}`,
  };
  const allowed = Object.keys(workspace.acceptance);
  const amends = Object.keys(task.reconcile ?? {});
  if (task.reconcile === undefined || amends.some((path) => !allowed.includes(path))) {
    return agentResult({
      ...result,
      head_sha: head,
      new_commit: head !== branchHead,
      files: head === branchHead ? [] : changedPaths(git.get(workspace.baseSha).files, tree.files),
      result_text: 'CONTRADICTION: both intents cannot hold at once.',
    });
  }
  const files = new Map(git.get(head).files);
  for (const [path, content] of Object.entries(task.reconcile)) files.set(path, content);
  const commit = git.commit([head], files, workspace.commitMessage);
  git.setRef(REPO, `refs/heads/${workspace.branch}`, commit.sha);
  return agentResult({
    ...result,
    head_sha: commit.sha,
    new_commit: true,
    files: changedPaths(git.get(workspace.baseSha).files, files),
    result_text: 'RECONCILED',
  });
}

/**
 * A run from scratch on the workspace's base (a re-execution, or a test author): the base,
 * the tests the workspace lists, then the scripted writes, committed onto the base.
 */
function freshRun(
  git: ToyGit,
  run: {
    task: ScriptedTask;
    writes: Readonly<Record<string, string>>;
    costUsd: number;
    session?: string;
  },
  instruction: EngineInstruction,
): InvocationResult {
  const workspace = instruction.workspace;
  const base = git.get(workspace.baseSha);
  const files = new Map(base.files);
  for (const [path, content] of Object.entries(workspace.acceptance)) files.set(path, content);
  for (const [path, content] of Object.entries(run.writes)) files.set(path, content);
  const commit = git.commit([base.sha], files, workspace.commitMessage);
  git.setRef(REPO, `refs/heads/${workspace.branch}`, commit.sha);
  return agentResult({
    ok: true,
    cost_usd: run.costUsd,
    session_id: run.session ?? `session-${run.task.id}-fresh`,
    head_sha: commit.sha,
    new_commit: true,
    files: changedPaths(base.files, files),
    pushed_ref: `refs/heads/${workspace.branch}`,
  });
}

/** The initial writes with the task's bug fixed: what a re-execution under a decision writes. */
function fixedWrites(task: ScriptedTask): Record<string, string> {
  return Object.fromEntries(
    Object.entries(task.writes).map(([path, content]) => [
      path,
      content.replaceAll(`BUG:${task.id}`, `OK:${task.id}`),
    ]),
  );
}

type ReworkWorld = {
  readonly git: ToyGit;
  readonly worktrees: Map<string, { files: Files; parents: readonly Sha[] }>;
  readonly task: ScriptedTask;
  readonly costUsd: number;
  /** Rules a sync turn adapts to (`adaptsOnSync`); empty for every other rework. */
  readonly adaptTo: readonly FailRule[];
};

/**
 * A rework as the driver runs it: merge the landed-line commit unless already merged (or a merge
 * is in progress), let the agent resolve and fix, then commit unless markers are left.
 */
function reworkRun(world: ReworkWorld, instruction: EngineInstruction): InvocationResult {
  const { git, task } = world;
  const workspace = instruction.workspace;
  const head = git.ref(REPO, `refs/heads/${workspace.branch}`);
  if (head === undefined || head !== workspace.headSha) {
    throw new Error(
      `${task.id}: bean head ${String(head)} is not the gateway's ${String(workspace.headSha)}`,
    );
  }
  const tree =
    world.worktrees.get(task.id) ??
    mergeIntoWorktree(git, head, workspace.merge?.sha ?? null, workspace.unionPaths);
  if (task.unresolvable === true) {
    world.worktrees.delete(task.id);
    return agentResult({
      ok: true,
      subtype: 'unresolved',
      cost_usd: world.costUsd,
      session_id: `session-${task.id}`,
    });
  }
  const fixed = task.stubborn === true ? new Map(tree.files) : fixedFiles(tree.files, task.id);
  repairForward(fixed, task);
  const files = adapted(fixed, task, world.adaptTo);
  const markersLeft = [...files.entries()]
    .filter(([, content]) => hasMarkers(content))
    .map(([path]) => path);
  if (markersLeft.length > 0) {
    world.worktrees.set(task.id, { files, parents: tree.parents });
    return agentResult({
      ok: true,
      cost_usd: world.costUsd,
      session_id: `session-${task.id}`,
      markers_left: markersLeft,
    });
  }
  world.worktrees.delete(task.id);
  const commit = git.commit(tree.parents, files, workspace.commitMessage);
  git.setRef(REPO, `refs/heads/${workspace.branch}`, commit.sha);
  return agentResult({
    ok: true,
    cost_usd: world.costUsd,
    session_id: `session-${task.id}`,
    head_sha: commit.sha,
    new_commit: true,
    files: changedPaths(git.get(workspace.baseSha).files, files),
    pushed_ref: `refs/heads/${workspace.branch}`,
  });
}

function mergeIntoWorktree(
  git: ToyGit,
  head: Sha,
  target: Sha | null,
  unionPaths: readonly string[],
): { files: Files; parents: readonly Sha[] } {
  if (target === null || git.isAncestor(target, head))
    return { files: git.get(head).files, parents: [head] };
  const base = git.mergeBase(head, target);
  const merged = mergeFiles(
    git.get(base).files,
    git.get(head).files,
    git.get(target).files,
    unionPaths,
  );
  return { files: merged.files, parents: [head, target] };
}

/** The tree after an adapting agent rewrote its change to clear its own broken clash rule. */
function adapted(
  files: Map<string, string>,
  task: ScriptedTask,
  rules: readonly FailRule[],
): Map<string, string> {
  const contents = [...files.values()];
  const isPresent = (marker: string): boolean => contents.some((text) => text.includes(marker));
  const isBroken = rules.some(
    (rule) => rule.markers.includes(`clash:${task.id}`) && rule.markers.every(isPresent),
  );
  const rewrite = task.reexecutions?.[0];
  if (!isBroken || rewrite === undefined) return files;
  const out = new Map(files);
  for (const [path, content] of Object.entries(rewrite)) {
    out.set(path, path.endsWith('.md') ? (files.get(path) ?? content) : content);
  }
  return out;
}

/** A bean that fixes the sprout forward defuses the markers it repairs (`fixes`), in place. */
function repairForward(files: Map<string, string>, task: ScriptedTask): void {
  for (const marker of task.fixes ?? []) {
    for (const [path, content] of files) {
      if (content.includes(marker))
        files.set(path, content.replaceAll(marker, marker.replaceAll(':', '-fixed-')));
    }
  }
}

/** The agent resolves every conflict by keeping both sides and fixes its own bug marker. */
function fixedFiles(files: Files, taskId: string): Map<string, string> {
  const fixed = new Map<string, string>();
  for (const [path, content] of files) {
    fixed.set(path, resolveBothSides(content).replaceAll(`BUG:${taskId}`, `OK:${taskId}`));
  }
  return fixed;
}

/** A complete driver result with the fields an agent did not set at their defaults. */
export function agentResult(fields: Partial<InvocationResult>): InvocationResult {
  return {
    ok: false,
    infra_error: null,
    timed_out: false,
    exit_code: 0,
    subtype: 'success',
    is_error: false,
    cost_usd: 0,
    cost_source: 'reported',
    num_turns: 1,
    duration_ms: null,
    duration_api_ms: null,
    wall_ms: 0,
    startup_ms: null,
    session_id: null,
    usage: {},
    model_usage: {},
    permission_denials: [],
    tool_uses: {},
    result_text: '',
    structured_output: null,
    transcript: null,
    notes: [],
    rate_limit: null,
    rate_limited: false,
    init: {},
    pushed_ref: null,
    head_sha: null,
    new_commit: false,
    files: [],
    tamper: [],
    markers_left: [],
    merge_conflicts: null,
    ...fields,
  };
}
