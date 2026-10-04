import type { Sha, TaskId } from '@beanstalk/shared-race/ids';

import type {
  CiState,
  Effects,
  EngineResponse,
  FinalState,
  InvocationRecord,
  InvocationStats,
  JobRecord,
  OpenInvocation,
  Seconds,
  SlotState,
  TaskState,
  TimerRecord,
} from './model';
import type { QueueState } from './queue/queue-state';
import type { V2State } from './v2/v2-state';

export type RunPhase = 'created' | 'running' | 'finishing' | 'done';

/** Every policy's state; one variant per policy. */
export type PolicyState = QueueState | V2State;

/** The whole run as the RunDO persists it after every step. */
export type EngineState = {
  version: 1;
  phase: RunPhase;
  createdAtMs: number;
  /** Latest `now` the engine has seen; keeps `t` monotonic under clock skew. */
  clock: Seconds;
  /** New starts are paused (the beanstalk error budget); idle slots then count as blocked. */
  paused: boolean;
  seq: number;
  counters: { inv: number; job: number; timer: number };
  startedAt: Seconds | null;
  raceT0: Seconds | null;
  endedAt: Seconds | null;
  baseSha: Sha | null;
  tasks: Record<string, TaskState>;
  order: TaskId[];
  slots: SlotState[];
  invocations: Record<string, OpenInvocation>;
  invRecords: InvocationRecord[];
  invStats: Record<string, InvocationStats>;
  spent: number;
  inflightCost: Record<string, number>;
  aborted: string | null;
  killedInvocations: number;
  conflictsMet: number;
  redValidations: number;
  jobs: Record<string, JobRecord>;
  timers: Record<string, TimerRecord>;
  ci: CiState;
  /** Acceptance tests a decision amended, by task (v2.2): they replace the task's own. */
  amendedTests: Record<string, Record<string, string>>;
  final: FinalState | null;
  policy: PolicyState | null;
};

export type StepOutput = {
  readonly state: EngineState;
  readonly effects: Effects;
  readonly response: EngineResponse;
};
