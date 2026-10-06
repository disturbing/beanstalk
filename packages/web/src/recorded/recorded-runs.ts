/**
 * The recorded runs bundled with the app (`fixtures/`, built from git by
 * `scripts/build-fixtures.mjs`): the Cloudflare race of the demo (`docs/claude-opus/12`), the
 * merge queue against Beanstalk v2.5 with dependency-aware starts, 12 Sonnet agents on seed 7.
 * They power replays, the side-by-side race and the explorer when no gateway is bound.
 */
import { z } from 'zod';

import type { RunId } from '@beanstalk/shared-race/ids';
import { RunId as RunIdSchema, Sha, TaskId } from '@beanstalk/shared-race/ids';

import queueEvents from '../../fixtures/u0ntf65lbe/events.jsonl?raw';
import queueRepo from '../../fixtures/u0ntf65lbe/repo.json?raw';
import queueTasks from '../../fixtures/u0ntf65lbe/tasks.json?raw';
import beanstalkEvents from '../../fixtures/j6boaclinn/events.jsonl?raw';
import beanstalkRepo from '../../fixtures/j6boaclinn/repo.json?raw';
import beanstalkTasks from '../../fixtures/j6boaclinn/tasks.json?raw';
import type { RaceEvent } from '@beanstalk/shared-ask/race/race-events';
import { parseEventLog } from '@beanstalk/shared-ask/race/race-events';
import type { RaceOptions } from '@beanstalk/shared-ask/race/race-state';

const FileStatRecord = z.object({
  path: z.string(),
  status: z.string(),
  additions: z.number().int(),
  deletions: z.number().int(),
});

const LineCommitRecord = z.object({
  sha: Sha,
  parent: Sha,
  task: TaskId.nullable(),
  kind: z.string(),
  idx: z.number().int().nullable(),
  t: z.number(),
  rebuilt: z.boolean(),
  files: z.array(FileStatRecord),
});

const BeanHeadRecord = z.object({
  task: TaskId,
  sha: Sha,
  kind: z.string(),
  t: z.number(),
  mergeBase: Sha,
  files: z.array(FileStatRecord),
});

/** `repo.json`: trees as [pathIndex, blobIndex] pairs over shared paths and contents. */
export const RepoSnapshot = z.object({
  base: Sha,
  paths: z.array(z.string()),
  blobs: z.array(z.string()),
  trees: z.record(z.string(), z.array(z.number().int().nonnegative())),
  line: z.array(LineCommitRecord),
  beanHeads: z.array(BeanHeadRecord),
});
export type RepoSnapshot = z.infer<typeof RepoSnapshot>;
export type LineCommitRecord = z.infer<typeof LineCommitRecord>;
export type BeanHeadRecord = z.infer<typeof BeanHeadRecord>;

/** What a bean is for: the arena task (title, the prompt as its intent, its own tests). */
export const TaskRecord = z.object({
  id: TaskId,
  title: z.string(),
  intent: z.string(),
  kind: z.string(),
  tests: z.array(z.string()),
});
export type TaskRecord = z.infer<typeof TaskRecord>;

export type RecordedRun = {
  readonly run: RunId;
  /** Short name in lists and the race view. */
  readonly label: string;
  readonly policyName: string;
  readonly summary: string;
  /** The engine's knobs no event states (`summary.json`'s `beanstalk.release_on_check`). */
  readonly options: RaceOptions;
  readonly events: readonly RaceEvent[];
  readonly tasks: readonly TaskRecord[];
  readonly repo: RepoSnapshot;
};

type RecordedSource = {
  readonly run: string;
  readonly label: string;
  readonly policyName: string;
  readonly summary: string;
  readonly options: RaceOptions;
  readonly texts: { readonly events: string; readonly tasks: string; readonly repo: string };
};

const SOURCES: readonly RecordedSource[] = [
  {
    run: 'j6boaclinn',
    label: 'Beanstalk v2.5',
    policyName: 'beanstalk-v2.5',
    summary:
      'Dependency-aware starts, pre-land checks on the exact merged tree, informed reworks, revert-first, decision cards',
    options: { releaseOnCheck: true },
    texts: { events: beanstalkEvents, tasks: beanstalkTasks, repo: beanstalkRepo },
  },
  {
    run: 'u0ntf65lbe',
    label: 'Merge queue',
    policyName: 'queue',
    summary: 'A batched, speculative, bisecting merge queue: the baseline',
    options: { releaseOnCheck: false },
    texts: { events: queueEvents, tasks: queueTasks, repo: queueRepo },
  },
];

/** Ids of the recorded runs, without parsing them. */
const RECORDED_RUN_IDS: ReadonlySet<string> = new Set(SOURCES.map((source) => source.run));

/** The recorded v2.5 run and the queue run, for the side-by-side race. */
export const RACE_PAIR = { left: 'u0ntf65lbe', right: 'j6boaclinn' } as const;

export function isRecordedRun(run: string): boolean {
  return RECORDED_RUN_IDS.has(run);
}

/**
 * A recorded run, parsed and validated. Throws when the bundled fixture is malformed (a
 * build bug, never user input).
 */
export function recordedRun(run: string): RecordedRun | undefined {
  const source = SOURCES.find((candidate) => candidate.run === run);
  return source === undefined ? undefined : parsedOnce(source);
}

/** Every recorded run, parsed. */
export function recordedRuns(): readonly RecordedRun[] {
  return SOURCES.map(parsedOnce);
}

/**
 * Parsing a fixture costs tens of milliseconds, so each is parsed once per isolate. This is
 * the one module-level cache in the app: it holds bundled constants, never request state.
 */
const parsedFixtures = new Map<string, RecordedRun>();

function parsedOnce(source: RecordedSource): RecordedRun {
  const cached = parsedFixtures.get(source.run);
  if (cached !== undefined) return cached;
  const parsed = parseRecorded(source);
  parsedFixtures.set(source.run, parsed);
  return parsed;
}

function parseRecorded(source: RecordedSource): RecordedRun {
  const parsed = parseEventLog(source.texts.events);
  const firstSkip = parsed.skipped.find((skipped) => skipped.kind === 'invalid');
  if (firstSkip !== undefined) {
    throw new Error(`fixture ${source.run}: event ${firstSkip.seq} skipped: ${firstSkip.reason}`);
  }
  return {
    run: RunIdSchema.parse(source.run),
    label: source.label,
    policyName: source.policyName,
    summary: source.summary,
    options: source.options,
    events: parsed.events,
    tasks: z.array(TaskRecord).parse(JSON.parse(source.texts.tasks)),
    repo: RepoSnapshot.parse(JSON.parse(source.texts.repo)),
  };
}
