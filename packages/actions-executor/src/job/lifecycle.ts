/**
 * One job's life in its Durable Object, free of the platform so it can be tested: accept the
 * spec, fetch the secrets, start a fresh container, hand it the job, relay its batches, stop it
 * on cancel or timeout, notice when it dies, destroy it at the end (and check it is gone), and
 * report one result. Logs pass through and are never stored here: the record holds the spec,
 * the phase, the step views and counters.
 *
 * Every way a job can end reaches `#finish` exactly once (the phase guards it), so the control
 * plane always gets a result: a crash, an eviction or a deploy that restarts the container is
 * `infrastructure_failure` with the reason, never silence.
 */
import type { JobConclusion, JobHandle, JobResult, JobSpec, StepView } from '../contract';
import type { Logger } from '../log';
import type { JobSink } from '../sink/job-sink';
import type { RunnerBatch, RunnerResult } from './runner-wire';
import {
  RunnerBatchSchema,
  RunnerResultSchema,
  RunnerStatusSchema,
  jobRequestOf,
} from './runner-wire';
import { StepTracker, jobConclusion, minutesBilled } from './translate';

/** How long a job may wait for container capacity before it fails as infrastructure. */
export const CAPACITY_BUDGET_MS = 5 * 60 * 1000;
export const CAPACITY_RETRY_MS = 10_000;
export const WATCHDOG_MS = 60_000;
/** Silence after which the runner's status is asked for, and after which the job is lost. */
export const SILENT_PROBE_MS = 90_000;
export const SILENT_LOST_MS = 180_000;
/** After a stop, how long the runner has to report before the container is destroyed anyway. */
export const STOP_GRACE_MS = 30_000;
/** The executor's own timeout fires this long after the runner's, as the backstop. */
export const TIMEOUT_BACKSTOP_MS = 60_000;
export const REPORT_RETRY_MS = 15_000;
export const REPORT_ATTEMPTS = 20;
/** The sink takes at most this many lines per batch. */
const MAX_SINK_LINES = 5000;

export type Phase = 'accepted' | 'running' | 'stopping' | 'finishing' | 'done';
export type StopReason = 'cancelled' | 'timed_out';
export type Task = 'launch' | 'watchdog' | 'timeout' | 'force-stop' | 'report';

/** What the Durable Object keeps for its job (no log lines, no secret values). */
export type JobRecord = {
  readonly spec: JobSpec;
  readonly phase: Phase;
  readonly acceptedAtMs: number;
  readonly containerStartedAtMs: number | null;
  readonly lastBatchIndex: number;
  readonly sinkSeq: number;
  readonly lastHeardMs: number;
  readonly steps: readonly StepView[];
  readonly stopReason: StopReason | null;
  readonly result: JobResult | null;
  readonly reported: boolean;
  readonly reportAttempts: number;
  /** Whether the container was confirmed gone after the destroy (null: never started). */
  readonly containerGone: boolean | null;
};

export type StartOutcome =
  | { readonly kind: 'started' }
  | { readonly kind: 'no-capacity'; readonly reason: string };

/** The job's container, as the lifecycle sees it. */
export type ContainerPort = {
  start(): Promise<StartOutcome>;
  post(path: string, body: unknown): Promise<Response>;
  get(path: string): Promise<Response>;
  destroy(): Promise<void>;
  isRunning(): Promise<boolean>;
  /** Keeps the container from sleeping while the job talks. */
  renew(): void;
};

export type LifecyclePorts = {
  readonly load: () => Promise<JobRecord | undefined>;
  readonly save: (record: JobRecord) => Promise<void>;
  readonly container: ContainerPort;
  readonly sink: (spec: JobSpec) => JobSink;
  readonly schedule: (delayMs: number, task: Task) => Promise<void>;
  readonly now: () => number;
  readonly log: Logger;
  /** The Durable Object's id, given back as the handle's `executorRef`. */
  readonly executorRef: string;
};

/** What `fromRunner` answers the container (its uplink retries anything but a 2xx). */
export type RunnerAnswer = { readonly status: number; readonly body: unknown };

type Ending = {
  readonly conclusion: JobConclusion;
  readonly outputs: Readonly<Record<string, string>>;
  readonly error: string | null;
  readonly runner: RunnerResult | null;
};

export class JobLifecycle {
  readonly #ports: LifecyclePorts;

  constructor(ports: LifecyclePorts) {
    this.#ports = ports;
  }

  /** Takes the job (once; the same spec again answers the same handle) and starts it. */
  async accept(spec: JobSpec): Promise<JobHandle> {
    const known = await this.#ports.load();
    if (known !== undefined) return this.#handle(known);
    const now = this.#ports.now();
    const record: JobRecord = {
      spec,
      phase: 'accepted',
      acceptedAtMs: now,
      containerStartedAtMs: null,
      lastBatchIndex: -1,
      sinkSeq: 0,
      lastHeardMs: now,
      steps: [],
      stopReason: null,
      result: null,
      reported: false,
      reportAttempts: 0,
      containerGone: null,
    };
    await this.#ports.save(record);
    await this.#ports.schedule(0, 'launch');
    this.#ports.log.info('job accepted', {
      job: spec.jobId,
      run: spec.runId,
      repo: spec.repo.fullName,
    });
    return this.#handle(record);
  }

  /** Secrets, a fresh container, the job handed over. Retried while capacity is short. */
  async launch(): Promise<void> {
    const record = await this.#ports.load();
    if (record?.phase !== 'accepted') return;
    const sink = this.#ports.sink(record.spec);
    let secrets: Readonly<Record<string, string>>;
    try {
      secrets = await sink.secrets();
    } catch (error) {
      await this.#finish(record, infra(`the job's secrets could not be read: ${message(error)}`));
      return;
    }
    const started = await this.#start(record);
    if (started === null) return;
    const response = await this.#ports.container
      .post('/v1/job', jobRequestOf(record.spec, secrets))
      .catch((error: unknown) => new Response(message(error), { status: 599 }));
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      await this.#finish(
        started,
        infra(`the job runner refused the job (${response.status}): ${detail}`),
      );
      return;
    }
    await this.#ports.save({ ...started, phase: 'running', lastHeardMs: this.#ports.now() });
    await this.#ports.schedule(
      record.spec.timeoutMinutes * 60_000 + TIMEOUT_BACKSTOP_MS,
      'timeout',
    );
    await this.#ports.schedule(WATCHDOG_MS, 'watchdog');
  }

  /** A request from the job's runner to `executor.internal`. */
  async fromRunner(path: string, body: unknown): Promise<RunnerAnswer> {
    if (path === '/v1/batches') return this.#onBatch(body);
    if (path === '/v1/result') return this.#onResult(body);
    return { status: 404, body: { error: 'unknown path' } };
  }

  /** Stops the job: the runner gets the stop, the container is destroyed after the grace. */
  async cancel(reason: StopReason): Promise<{ readonly stopping: boolean } | null> {
    const record = await this.#ports.load();
    if (record === undefined) return null;
    if (record.phase === 'done' || record.phase === 'finishing') return { stopping: false };
    if (record.phase === 'accepted') {
      await this.#finish(record, stopped(reason, 'stopped before it started'));
      return { stopping: true };
    }
    if (record.phase === 'stopping') return { stopping: true };
    await this.#ports.save({ ...record, phase: 'stopping', stopReason: reason });
    const runnerReason = reason === 'timed_out' ? 'timeout' : 'cancelled';
    await this.#ports.container
      .post('/v1/cancel', { reason: runnerReason })
      .catch((error: unknown) => {
        this.#ports.log.warn('the runner did not take the stop', { job: record.spec.jobId, error });
      });
    await this.#ports.schedule(STOP_GRACE_MS, 'force-stop');
    return { stopping: true };
  }

  async onTimeout(): Promise<void> {
    const record = await this.#ports.load();
    if (record?.phase === 'running') await this.cancel('timed_out');
  }

  async onForceStop(): Promise<void> {
    const record = await this.#ports.load();
    if (record?.phase !== 'stopping') return;
    const reason = record.stopReason ?? 'cancelled';
    await this.#finish(
      record,
      stopped(reason, 'the runner did not report within 30 s of the stop'),
    );
  }

  /** Every minute while the job runs: is the container alive, is the runner still talking? */
  async onWatchdog(): Promise<void> {
    const record = await this.#ports.load();
    if (record === undefined || (record.phase !== 'running' && record.phase !== 'stopping')) return;
    if (!(await this.#ports.container.isRunning())) {
      await this.#finish(record, infra('the container stopped before the job reported a result'));
      return;
    }
    const silentMs = this.#ports.now() - record.lastHeardMs;
    if (silentMs >= SILENT_PROBE_MS && (await this.#recoverResult())) return;
    if (silentMs >= SILENT_LOST_MS) {
      await this.#finish(
        record,
        infra(`the job runner was silent for ${Math.round(silentMs / 1000)} s`),
      );
      return;
    }
    await this.#ports.schedule(WATCHDOG_MS, 'watchdog');
  }

  /** The container exited. Expected after the destroy; anything earlier is a lost job. */
  async onContainerStopped(detail: {
    readonly exitCode: number;
    readonly reason: string;
  }): Promise<void> {
    const record = await this.#ports.load();
    if (record === undefined || record.phase === 'done' || record.phase === 'finishing') return;
    if (record.containerStartedAtMs === null) return;
    await this.#finish(
      record,
      infra(
        `the container stopped (${detail.reason}, exit ${detail.exitCode}) before the job finished; ` +
          'a deploy or a host restart ends running jobs',
      ),
    );
  }

  /** Retries delivering the result to the control plane. */
  async onReport(): Promise<void> {
    const record = await this.#ports.load();
    if (record?.phase !== 'done' || record.reported || record.result === null) return;
    await this.#report(record, record.result);
  }

  async #start(record: JobRecord): Promise<JobRecord | null> {
    const outcome = await this.#ports.container
      .start()
      .catch((error: unknown): StartOutcome | Error =>
        error instanceof Error ? error : new Error(message(error)),
      );
    if (outcome instanceof Error) {
      await this.#finish(record, infra(`the container did not start: ${outcome.message}`));
      return null;
    }
    if (outcome.kind === 'no-capacity') {
      const waitedMs = this.#ports.now() - record.acceptedAtMs;
      if (waitedMs >= CAPACITY_BUDGET_MS) {
        await this.#finish(
          record,
          infra(`no container capacity for ${Math.round(waitedMs / 1000)} s: ${outcome.reason}`),
        );
        return null;
      }
      this.#ports.log.warn('no container capacity, waiting', {
        job: record.spec.jobId,
        waited_ms: waitedMs,
      });
      await this.#ports.schedule(CAPACITY_RETRY_MS, 'launch');
      return null;
    }
    const started = { ...record, containerStartedAtMs: this.#ports.now() };
    await this.#ports.save(started);
    return started;
  }

  async #onBatch(body: unknown): Promise<RunnerAnswer> {
    const parsed = RunnerBatchSchema.safeParse(body);
    if (!parsed.success) return { status: 400, body: { error: 'bad batch' } };
    const record = await this.#ports.load();
    if (record === undefined) return { status: 404, body: { error: 'no job' } };
    this.#ports.container.renew();
    if (record.phase === 'done' || record.phase === 'finishing')
      return { status: 200, body: { ok: true } };
    if (parsed.data.index <= record.lastBatchIndex)
      return { status: 200, body: { duplicate: true } };
    const relayed = await this.#relay(record, parsed.data);
    await this.#ports.save(relayed.record);
    if (relayed.cancelRequested) await this.cancel('cancelled');
    return { status: 200, body: { ok: true } };
  }

  async #relay(
    record: JobRecord,
    batch: RunnerBatch,
  ): Promise<{ readonly record: JobRecord; readonly cancelRequested: boolean }> {
    const tracker = new StepTracker(record.spec.steps, record.steps);
    const { lines, changed } = tracker.translate(batch.lines);
    let sinkSeq = record.sinkSeq;
    let cancelRequested = false;
    const sink = this.#ports.sink(record.spec);
    for (
      let start = 0;
      start < lines.length || (start === 0 && changed.length > 0);
      start += MAX_SINK_LINES
    ) {
      sinkSeq += 1;
      const steps = start === 0 ? changed : [];
      // oxlint-disable-next-line no-await-in-loop -- batches go to the sink in order
      const answer = await sink.logs({
        seq: sinkSeq,
        lines: lines.slice(start, start + MAX_SINK_LINES),
        steps,
      });
      cancelRequested ||= answer.cancelRequested;
    }
    const updated: JobRecord = {
      ...record,
      lastBatchIndex: batch.index,
      sinkSeq,
      lastHeardMs: this.#ports.now(),
      steps: tracker.steps(),
    };
    return { record: updated, cancelRequested };
  }

  async #onResult(body: unknown): Promise<RunnerAnswer> {
    const parsed = RunnerResultSchema.safeParse(body);
    if (!parsed.success) return { status: 400, body: { error: 'bad result' } };
    const record = await this.#ports.load();
    if (record === undefined) return { status: 404, body: { error: 'no job' } };
    if (record.phase === 'done' || record.phase === 'finishing')
      return { status: 200, body: { ok: true } };
    await this.#finish(record, fromRunner(parsed.data));
    return { status: 200, body: { ok: true } };
  }

  /** The result the runner could not post, read from its status (a lost post). */
  async #recoverResult(): Promise<boolean> {
    const response = await this.#ports.container.get('/v1/status').catch(() => null);
    if (response?.ok !== true) return false;
    const status = RunnerStatusSchema.safeParse(await response.json());
    if (!status.success || status.data.state !== 'finished') return false;
    await this.#onResult(status.data.result);
    return true;
  }

  async #finish(record: JobRecord, ending: Ending): Promise<void> {
    const finishing: JobRecord = { ...record, phase: 'finishing' };
    await this.#ports.save(finishing);
    const now = this.#ports.now();
    const tracker = new StepTracker(record.spec.steps, record.steps);
    tracker.closeOpenSteps(ending.conclusion, now);
    const containerGone = record.containerStartedAtMs === null ? null : await this.#destroy(record);
    const destroyedAtMs = this.#ports.now();
    const result: JobResult = {
      conclusion: ending.conclusion,
      outputs: ending.outputs,
      durationMs: durationOf(record, ending.runner, destroyedAtMs),
      minutesBilled:
        record.containerStartedAtMs === null
          ? 0
          : minutesBilled(destroyedAtMs - record.containerStartedAtMs),
      steps: tracker.steps(),
      error: ending.error,
    };
    const done: JobRecord = {
      ...finishing,
      phase: 'done',
      steps: result.steps,
      result,
      containerGone,
    };
    await this.#ports.save(done);
    this.#ports.log.info('job finished', {
      job: record.spec.jobId,
      conclusion: result.conclusion,
      minutes: result.minutesBilled,
      container_gone: containerGone,
    });
    await this.#report(done, result);
  }

  /** Destroys the container and checks it is gone; one more destroy if it is not. */
  async #destroy(record: JobRecord): Promise<boolean> {
    const container = this.#ports.container;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      // oxlint-disable-next-line no-await-in-loop -- the second destroy only if the first left it running
      await container.destroy().catch((error: unknown) => {
        this.#ports.log.warn('container destroy failed', {
          job: record.spec.jobId,
          attempt,
          error,
        });
      });
      // oxlint-disable-next-line no-await-in-loop -- checked after each destroy
      if (!(await container.isRunning())) return true;
    }
    this.#ports.log.error('the container is still running after two destroys', {
      job: record.spec.jobId,
    });
    return false;
  }

  async #report(record: JobRecord, result: JobResult): Promise<void> {
    try {
      await this.#ports.sink(record.spec).finished(result);
      await this.#ports.save({ ...record, reported: true });
    } catch (error) {
      const attempts = record.reportAttempts + 1;
      this.#ports.log.warn('the result could not be reported', {
        job: record.spec.jobId,
        attempts,
        error,
      });
      await this.#ports.save({ ...record, reportAttempts: attempts });
      if (attempts < REPORT_ATTEMPTS) await this.#ports.schedule(REPORT_RETRY_MS, 'report');
    }
  }

  #handle(record: JobRecord): JobHandle {
    return {
      jobId: record.spec.jobId,
      executorRef: this.#ports.executorRef,
      acceptedAt: new Date(record.acceptedAtMs).toISOString(),
    };
  }
}

function fromRunner(result: RunnerResult): Ending {
  const conclusion = jobConclusion(result);
  const error =
    result.reason === undefined || result.reason === 'steps'
      ? null
      : (result.error ?? `the job ended: ${result.reason}`);
  return { conclusion, outputs: result.outputs, error, runner: result };
}

function infra(reason: string): Ending {
  return { conclusion: 'infrastructure_failure', outputs: {}, error: reason, runner: null };
}

function stopped(reason: StopReason, detail: string): Ending {
  const what = reason === 'timed_out' ? 'the job ran past its timeout' : 'the job was cancelled';
  return { conclusion: reason, outputs: {}, error: `${what}; ${detail}`, runner: null };
}

function durationOf(record: JobRecord, runner: RunnerResult | null, endMs: number): number {
  if (runner !== null) return Math.max(0, runner.finishedAt - runner.startedAt);
  return Math.max(0, endMs - (record.containerStartedAtMs ?? record.acceptedAtMs));
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
