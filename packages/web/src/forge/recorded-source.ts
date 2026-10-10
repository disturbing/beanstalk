/**
 * The replay adapter's data side: a `ForgeSource` over the bundled recorded runs. With
 * `asOf`, it answers as the run stood at that race second (the sprout, the stalk, the
 * beans in flight), so the explorer can travel through a recorded race.
 */
import type { RunId, Sha, TaskId } from '@gitstalk/shared-race/ids';

import type { RaceEvent } from '@gitstalk/shared-ask/race/race-events';
import { raceCounters } from '@gitstalk/shared-ask/race/race-counters';
import type { RaceState } from '@gitstalk/shared-ask/race/race-state';
import { reduceRace } from '@gitstalk/shared-ask/race/reduce-race';
import { importClosure, isTestFile } from '@gitstalk/shared-ask/repo/imports';
import { folderOf } from '@gitstalk/shared-ask/repo/paths';
import type { RefName, RepoTree } from '@gitstalk/shared-ask/repo/repo-types';
import type { RecordedRun } from '../recorded/recorded-runs';
import { recordedRun, recordedRuns } from '../recorded/recorded-runs';
import type { SnapshotReader } from '../recorded/snapshot-reader';
import { openSnapshot } from '../recorded/snapshot-reader';
import type { TaskInfo } from '@gitstalk/shared-ask/forge/bean-records';
import {
  beanRecord,
  beansTouching,
  decisionRecords,
  testRecord,
} from '@gitstalk/shared-ask/forge/bean-records';
import { ForgeError } from '@gitstalk/shared-ask/forge/forge-errors';
import type {
  BeanDetail,
  BeanRecord,
  DecideOutcome,
  ForgeSource,
  RunListing,
  TestRecord,
} from '@gitstalk/shared-ask/forge/forge-source';

type RecordedContext = {
  readonly recorded: RecordedRun;
  readonly events: readonly RaceEvent[];
  readonly state: RaceState;
  readonly reader: SnapshotReader;
  readonly tasks: ReadonlyMap<string, TaskInfo>;
  readonly records: ReadonlyMap<TaskId, BeanRecord>;
  readonly sprout: Sha;
  readonly stalk: Sha;
};

/**
 * A source over the recorded runs, as of race second `asOf` (default: the end). `fixture`
 * adds a run that is not bundled with the app (a test's own fixture).
 */
export function recordedSource(
  options: { readonly asOf?: number; readonly fixture?: RecordedRun } = {},
): ForgeSource {
  const asOf = options.asOf ?? Number.POSITIVE_INFINITY;
  const contexts = new Map<string, RecordedContext>();

  function context(run: RunId): RecordedContext {
    const cached = contexts.get(run);
    if (cached !== undefined) return cached;
    const recorded = options.fixture?.run === run ? options.fixture : recordedRun(run);
    if (recorded === undefined) throw new ForgeError(`no recorded run ${run}`, 'not_found');
    const created = buildContext(recorded, asOf);
    contexts.set(run, created);
    return created;
  }

  function resolve(run: RunId, ref: RefName): Sha {
    const ctx = context(run);
    if (ref === 'sprout') return ctx.sprout;
    if (ref === 'stalk') return ctx.stalk;
    if (ref === 'base') return ctx.reader.base;
    if (ctx.reader.hasCommit(ref)) return ref;
    throw new ForgeError(`${ref} is not a commit of run ${run}`, 'bad_ref');
  }

  return {
    listRuns: () => Promise.resolve(recordedRuns().map(listing)),
    // v2.2 and later free the agent at the pre-land check; the queue's agents wait.
    runOptions: (run) => Promise.resolve(context(run).recorded.options),
    runEvents: (run, after, limit) => {
      const events = context(run).events.filter((event) => event.seq > after);
      const page = events.slice(0, limit);
      return Promise.resolve({
        events: page,
        nextAfter: page.at(-1)?.seq ?? after,
        done: page.length === events.length,
      });
    },
    repoTree: (run, ref): Promise<RepoTree> => {
      const sha = resolve(run, ref);
      return Promise.resolve({ ref, sha, files: context(run).reader.treeFiles(sha) });
    },
    repoFile: (run, ref, path) => {
      const sha = resolve(run, ref);
      const text = context(run).reader.readFile(sha, path);
      return Promise.resolve(text === undefined ? undefined : { ref, sha, path, text });
    },
    repoDiff: (run, from, to, paths) =>
      Promise.resolve(context(run).reader.diff(resolve(run, from), resolve(run, to), paths)),
    repoLog: (run, ref, query) => {
      const commits = context(run).reader.log(resolve(run, ref), query?.paths);
      return Promise.resolve(commits.slice(0, query?.limit ?? commits.length));
    },
    repoGrep: (run, ref, pattern, paths) =>
      Promise.resolve(context(run).reader.grep(resolve(run, ref), pattern, paths)),
    beansByPath: (run, paths) =>
      Promise.resolve(beansTouching([...context(run).records.values()], paths)),
    beanDetail: (run, bean) => Promise.resolve(beanDetail(context(run), bean)),
    decisions: (run, paths) =>
      Promise.resolve(decisionRecords(context(run).state, context(run).records, paths)),
    testsFor: (run, paths) => Promise.resolve(testsFor(context(run), paths)),
    decide: (): Promise<DecideOutcome> =>
      Promise.resolve({
        ok: false,
        code: 'read_only',
        message: 'This is a recorded run: its decision was made during the race.',
      }),
  };
}

function buildContext(recorded: RecordedRun, asOf: number): RecordedContext {
  const events = recorded.events.filter((event) => event.t <= asOf);
  const state = reduceRace(events, recorded.options);
  const reader = openSnapshot(recorded.repo, recorded.tasks);
  const tasks = new Map(recorded.tasks.map((task) => [task.id, task]));
  const visibleLine = recorded.repo.line.filter((commit) => commit.t <= asOf);
  const sprout = visibleLine.at(-1)?.sha ?? reader.base;
  const stalk = state.meta?.policy === 'queue' ? sprout : (state.line.stalkSha ?? reader.base);
  const records = new Map(
    Object.values(state.beans).map((bean) => [
      bean.id,
      beanRecord(
        bean,
        tasks.get(bean.id),
        ownFiles(recorded, bean.id, { asOf, landedSha: bean.landedSha }),
      ),
    ]),
  );
  return { recorded, events, state, reader, tasks, records, sprout, stalk };
}

/** A bean's own files from git: its landed commit, else its newest head (vs the line). */
function ownFiles(
  recorded: RecordedRun,
  task: TaskId,
  at: { readonly asOf: number; readonly landedSha: Sha | null },
): readonly string[] | undefined {
  const landed = recorded.repo.line.find((commit) => commit.sha === at.landedSha);
  if (landed !== undefined) return landed.files.map((file) => file.path);
  const head = latestHead(recorded, task, at.asOf);
  return head?.files.map((file) => file.path);
}

function latestHead(recorded: RecordedRun, task: TaskId, asOf: number) {
  return recorded.repo.beanHeads.findLast((head) => head.task === task && head.t <= asOf);
}

function beanDetail(ctx: RecordedContext, id: TaskId): BeanDetail | undefined {
  const bean = ctx.state.beans[id];
  const record = ctx.records.get(id);
  if (bean === undefined || record === undefined) return undefined;
  const task = ctx.tasks.get(id);
  const range = diffRange(ctx, id, bean.landedSha);
  return {
    ...record,
    tests: task?.tests ?? [],
    steps: bean.steps,
    head: bean.head,
    diffBase: range?.base ?? null,
    diffHead: range?.head ?? null,
    checks: bean.checks,
    redChecks: bean.redChecks,
    conflicts: bean.conflicts,
    lastMessage: bean.lastMessage,
    dropReason: bean.dropReason,
  };
}

/** The bean's own change: its landing on the line, else its newest head against the line. */
function diffRange(
  ctx: RecordedContext,
  id: TaskId,
  landedSha: Sha | null,
): { readonly base: Sha; readonly head: Sha } | undefined {
  const landed = ctx.recorded.repo.line.find((commit) => commit.sha === landedSha);
  if (landed !== undefined) return { base: landed.parent, head: landed.sha };
  const head = latestHead(ctx.recorded, id, ctx.state.clock);
  return head === undefined ? undefined : { base: head.mergeBase, head: head.sha };
}

function testsFor(ctx: RecordedContext, paths: readonly string[]): readonly TestRecord[] {
  const read = (path: string) => ctx.reader.readFile(ctx.sprout, path);
  const tests = ctx.reader.treeFiles(ctx.sprout).filter((file) => isTestFile(file.path));
  const wanted = new Set(paths);
  return tests.flatMap((file) => {
    const covers = importClosure(file.path, read).filter((path) => !isTestFile(path));
    if (!isRelevantTest(file.path, covers, wanted)) return [];
    const owner = ownerOf(ctx, file.path);
    return [
      testRecord({
        path: file.path,
        covers,
        owner,
        existsFrom: existsFrom(ctx, file.path),
        events: ctx.events,
      }),
    ];
  });
}

/** A test answers for a path it is, imports, or sits beside (a module's own tests). */
function isRelevantTest(
  test: string,
  covers: readonly string[],
  wanted: ReadonlySet<string>,
): boolean {
  if (wanted.size === 0 || wanted.has(test)) return true;
  if (covers.some((path) => wanted.has(path))) return true;
  const folder = folderOf(test);
  return [...wanted].some((path) => folderOf(path) === folder);
}

function ownerOf(ctx: RecordedContext, path: string): TaskId | null {
  return ctx.recorded.tasks.find((task) => task.tests.includes(path))?.id ?? null;
}

/** When a test file appeared on the line: 0 for the base, else the commit that added it. */
function existsFrom(ctx: RecordedContext, path: string): number {
  if (ctx.reader.readFile(ctx.reader.base, path) !== undefined) return 0;
  const added = ctx.recorded.repo.line.find((commit) =>
    commit.files.some((file) => file.path === path && file.status.startsWith('A')),
  );
  return added?.t ?? Number.POSITIVE_INFINITY;
}

function listing(recorded: RecordedRun): RunListing {
  const state = reduceRace(recorded.events, recorded.options);
  const counters = raceCounters(state);
  const createdAt = state.epochMs === null ? null : new Date(state.epochMs).toISOString();
  return {
    run: recorded.run,
    source: 'recorded',
    label: recorded.label,
    policy: state.meta?.policy ?? 'beanstalk',
    phase: 'done',
    agents: state.meta?.agents ?? 0,
    model: state.meta?.model ?? null,
    createdAt,
    beans: counters.beans,
    green: counters.green,
    costUsd: counters.costUsd,
  };
}
