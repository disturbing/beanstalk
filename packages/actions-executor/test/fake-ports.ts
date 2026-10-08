/**
 * Fakes for `JobLifecycle`'s ports: a container that records what it was sent, a sink that
 * records batches and results, a clock the test moves, and a task list instead of alarms.
 */
import {
  ActionsJobId,
  ActionsRunId,
  SecretName,
  WorkflowPath,
} from '@beanstalk/shared-race/actions';

import type { JobLogBatch, JobResult, JobSpec } from '../src/contract';
import type {
  ContainerPort,
  JobRecord,
  LifecyclePorts,
  StartOutcome,
  Task,
} from '../src/job/lifecycle';
import { JobLifecycle } from '../src/job/lifecycle';
import { createLogger } from '../src/log';
import type { JobSink } from '../src/sink/job-sink';

export const JOB_ID = '7d1f8a3e-58f4-4b1a-9f3e-0c7c2f0b1a01';
export const RUN_ID = '0e4e9c55-2b9e-4c51-8d0f-5f2f6b7c8d9e';
export const SECRET_VALUE = 'cf-api-token-value-1234';

export function spec(overrides: Partial<JobSpec> = {}): JobSpec {
  return {
    jobId: ActionsJobId.parse(JOB_ID),
    repo: { id: 'repo-1', owner: 'coop', name: 'app', fullName: 'coop/app' },
    runId: ActionsRunId.parse(RUN_ID),
    runNumber: 3,
    workflowPath: WorkflowPath.parse('.github/workflows/ci.yml'),
    workflowName: 'CI',
    jobName: 'test',
    displayName: 'test',
    matrix: null,
    event: 'push',
    eventPayload: { ref: 'refs/heads/main' },
    context: {
      sha: 'b0460d47d3015813b06734980f9cdf78b56c090f',
      ref: 'refs/heads/main',
      refName: 'main',
      actor: 'coop',
      serverUrl: 'https://gateway.example',
      apiUrl: 'https://gateway.example/api/v3',
      runAttempt: 1,
    },
    checkout: {
      url: 'https://gateway.example/coop/app',
      token: 'bsj_job_token',
      sha: 'b0460d47d3015813b06734980f9cdf78b56c090f',
    },
    needs: {},
    inputs: {},
    env: { BEANSTALK_LINE: 'stalk' },
    secretNames: [SecretName.parse('CLOUDFLARE_API_TOKEN')],
    steps: [
      { number: 1, id: null, name: 'actions/checkout@v4', uses: 'actions/checkout@v4', run: null },
      { number: 2, id: null, name: 'npm ci', uses: null, run: 'npm ci' },
      { number: 3, id: 'v', name: 'version', uses: null, run: 'echo' },
    ],
    outputs: {},
    timeoutMinutes: 60,
    image: 'ubuntu-24.04',
    report: { token: 'report-token' },
    ...overrides,
  };
}

export class FakeContainer implements ContainerPort {
  running = false;
  starts: StartOutcome[] = [];
  posts: { path: string; body: unknown }[] = [];
  destroys = 0;
  /** A container that ignores destroy (to test the check after it). */
  isStuck = false;
  status: unknown = { state: 'running', jobId: JOB_ID, startedAt: 0 };
  renewals = 0;

  async start(): Promise<StartOutcome> {
    const outcome = this.starts.shift() ?? { kind: 'started' };
    if (outcome.kind === 'started') this.running = true;
    return outcome;
  }

  async post(path: string, body: unknown): Promise<Response> {
    this.posts.push({ path, body });
    return new Response(JSON.stringify({ accepted: true }), { status: 202 });
  }

  async get(): Promise<Response> {
    return Response.json(this.status);
  }

  async destroy(): Promise<void> {
    this.destroys += 1;
    if (!this.isStuck) this.running = false;
  }

  async isRunning(): Promise<boolean> {
    return this.running;
  }

  renew(): void {
    this.renewals += 1;
  }
}

export class FakeSink implements JobSink {
  batches: JobLogBatch[] = [];
  results: JobResult[] = [];
  secretReads = 0;
  cancelRequested = false;
  failFinished = 0;

  async secrets(): Promise<Readonly<Record<string, string>>> {
    this.secretReads += 1;
    return { CLOUDFLARE_API_TOKEN: SECRET_VALUE };
  }

  async logs(batch: JobLogBatch): Promise<{ readonly cancelRequested: boolean }> {
    this.batches.push(batch);
    return { cancelRequested: this.cancelRequested };
  }

  async finished(result: JobResult): Promise<void> {
    if (this.failFinished > 0) {
      this.failFinished -= 1;
      throw new Error('control plane unavailable');
    }
    this.results.push(result);
  }
}

export type Harness = {
  readonly lifecycle: JobLifecycle;
  readonly container: FakeContainer;
  readonly sink: FakeSink;
  readonly tasks: { delayMs: number; task: Task }[];
  readonly saved: JobRecord[];
  record(): JobRecord | undefined;
  advance(ms: number): void;
  now(): number;
};

export function harness(): Harness {
  let clock = 1_700_000_000_000;
  let stored: JobRecord | undefined;
  const saved: JobRecord[] = [];
  const container = new FakeContainer();
  const sink = new FakeSink();
  const tasks: { delayMs: number; task: Task }[] = [];
  const ports: LifecyclePorts = {
    load: async () => stored,
    save: async (record) => {
      stored = structuredClone(record);
      saved.push(stored);
    },
    container,
    sink: () => sink,
    schedule: async (delayMs, task) => {
      tasks.push({ delayMs, task });
    },
    now: () => clock,
    log: createLogger('error'),
    executorRef: 'do-id-1',
  };
  return {
    lifecycle: new JobLifecycle(ports),
    container,
    sink,
    tasks,
    saved,
    record: () => stored,
    advance: (ms) => {
      clock += ms;
    },
    now: () => clock,
  };
}

/** A runner log line. */
export function line(seq: number, fields: Record<string, unknown>): Record<string, unknown> {
  return { seq, at: 1_700_000_000_000 + seq, level: 'info', ...fields };
}

export function runnerResult(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    jobId: JOB_ID,
    conclusion: 'success',
    outputs: { node: 'v20.20.2' },
    unresolvedOutputs: [],
    stepOutputs: {},
    steps: [],
    annotations: [],
    summaries: [],
    startedAt: 1_700_000_000_000,
    finishedAt: 1_700_000_029_000,
    lines: 10,
    batches: 2,
    actVersion: '0.2.89',
    imageVersion: 'test',
    ...fields,
  };
}
