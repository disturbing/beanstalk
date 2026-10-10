import type { Sha, SlotId, TaskId } from '@gitstalk/shared-race/ids';

import type { CheckResult, CiId, JobId, Seconds, TimerId } from '../model';

export type EjectReason = 'conflict' | 'red';

/** What the integrator knew about a PR when it ejected it to its author. */
export type EjectInfo = {
  files: string[] | null;
  failing: string[] | null;
  output: string;
  batch: string | null;
  /**
   * Paths a merge of main into the PR leaves conflicted, with the main they were computed
   * against. A rework that starts while main is still that commit needs no runner call.
   */
  mainConflicts: { main: Sha; files: string[] } | null;
};

export type ReworkJob = { task: TaskId; reason: EjectReason; info: EjectInfo };

/** A batch of squash-merged PRs stacked on `base` and tested as one (`policy_queue.Batch`). */
export type Batch = {
  id: string;
  base: Sha;
  prs: TaskId[];
  commits: Sha[];
  /** Files each commit changed relative to its parent (the squash results). */
  files: string[][];
  head: Sha;
  ciId: CiId | null;
  result: CheckResult | null;
  cancelled: boolean;
};

export type BuildStep =
  | { phase: 'squash'; task: TaskId; jobId: JobId }
  | { phase: 'main-check'; task: TaskId; jobId: JobId; conflicts: string[] };

/** `build_batch` in progress: PRs squashed onto `cur` one runner call at a time. */
export type BuildState = {
  base: Sha;
  cur: Sha;
  prs: TaskId[];
  commits: Sha[];
  files: string[][];
  step: BuildStep | null;
};

export type LandContinuation = { kind: 'resolve' } | { kind: 'bisect-end' };

/** `land` in progress: main is being moved to the last commit with a push-with-lease. */
export type LandingState = {
  jobId: JobId;
  prs: TaskId[];
  commits: Sha[];
  files: string[][];
  /** What the integrator does once main has moved. */
  after: LandContinuation;
};

/** The integrator lock (the harness's `self.lock`) and what holds it across a runner call. */
export type QueueLock =
  | { kind: 'build'; build: BuildState }
  | { kind: 'land'; landing: LandingState };

/** Work that waits for the integrator lock, in arrival order (asyncio.Lock is FIFO). */
export type LockedAction =
  | { kind: 'enqueue'; task: TaskId }
  | { kind: 'batch-result'; batch: string; result: CheckResult }
  | { kind: 'bisect-end' }
  | { kind: 'drop'; task: TaskId; reason: string };

/** K-ary search over the red batch's prefixes for the first PR that turns it red. */
export type BisectState = {
  batch: Batch;
  lo: number;
  hi: number;
  /** Suite results by prefix length. */
  results: Record<string, CheckResult>;
  /** Outstanding probes of the current round: CI run → prefix length. */
  probes: Record<string, number>;
  points: number[];
};

/** A PR's way back to the queue after an ejection (`rework_flow`), bound to one slot. */
export type ReworkFlow = {
  task: TaskId;
  slot: SlotId;
  reason: EjectReason;
  info: EjectInfo;
  /** Main as it was when the flow started: the commit the driver merges. */
  target: Sha;
  /** Paths the merge of `target` leaves conflicted; null while the runner works it out. */
  conflicts: string[] | null;
  prepJobId: JobId | null;
};

export type QueueStats = {
  batches: number;
  batches_green: number;
  batches_red: number;
  batches_cancelled: number;
  bisections: number;
  bisect_runs: number;
  ejections_conflict: number;
  ejections_red: number;
  requeued_without_agent: number;
  held_behind_inflight: number;
  batch_sizes: number[];
};

export type QueueState = {
  kind: 'queue';
  main: Sha;
  pending: TaskId[];
  inflight: Batch[];
  bisect: BisectState | null;
  bisecting: boolean;
  unstarted: TaskId[];
  reworkJobs: ReworkJob[];
  batchSeq: number;
  holdForInflight: boolean;
  enqueuedAt: Record<string, Seconds>;
  ejectionsTotal: Record<string, number>;
  stats: QueueStats;
  lock: QueueLock | null;
  lockQueue: LockedAction[];
  reworks: Record<string, ReworkFlow>;
  batchWaitTimer: TimerId | null;
};
