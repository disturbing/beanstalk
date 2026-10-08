/**
 * ActionsJobContainer: one Durable Object and one fresh container per job, named by the job id
 * (a UUID the control plane mints per job and matrix leg, never reused). The object wires the
 * platform into `JobLifecycle`: its storage, its container, the sink, `schedule()` for the
 * timers (the Container class owns the alarm), and two outbound virtual hosts:
 *
 * - `executor.internal`: the runner's batches and result, handed to this object;
 * - `bs.internal`: Beanstalk's git for the job's repository, github.com for actions
 *   (`../outbound/forge-host.ts`).
 *
 * Internet egress stays on: steps install packages (`npm ci`) and fetch toolchains.
 */
import { Container } from '@cloudflare/containers';
import type { OutboundHandlerContext, StopParams } from '@cloudflare/containers';

import { readConfig } from '../config';
import type { JobHandle, JobSpec } from '../contract';
import { createLogger } from '../log';
import type { Logger } from '../log';
import { answerForge } from '../outbound/forge-host';
import type { ForgeJob } from '../outbound/forge-host';
import { sinkFor } from '../sink/job-sink';
import type { ContainerPort, JobRecord, StartOutcome, StopReason, Task } from './lifecycle';
import { JobLifecycle } from './lifecycle';
import { EXECUTOR_HOST, FORGE_HOST } from './runner-wire';

const RUNNER_PORT = 8080;
const RECORD_KEY = 'job';
/** Idle time before an idle container sleeps; renewed by every batch, and the job is watched. */
const SLEEP_AFTER = '10m';
/** What Cloudflare answers when no instance can start (as in the gateway's runner transport). */
const CAPACITY_MESSAGES = [
  /maximum number of running container instances/i,
  /no container instance available/i,
];

/** The runner's request to `executor.internal`, handed to the job's own object. */
async function answerExecutor(
  request: Request,
  env: Env,
  ctx: OutboundHandlerContext,
): Promise<Response> {
  const stub = env.ACTIONS_JOBS_DO.get(env.ACTIONS_JOBS_DO.idFromString(ctx.containerId));
  const answer = await stub.fromRunner(new URL(request.url).pathname, await request.text());
  return new Response(answer.body, {
    status: answer.status,
    headers: { 'content-type': 'application/json' },
  });
}

/** `bs.internal`, with the job's repository passed as the handler's params. */
async function answerForgeHost(
  request: Request,
  env: Env,
  ctx: OutboundHandlerContext<ForgeJob>,
): Promise<Response> {
  return answerForge(request, ctx.params, env.GATEWAY);
}

/** What the admin route shows of a job. */
export type JobSummary = {
  readonly jobId: string;
  readonly repo: string;
  readonly jobName: string;
  readonly phase: JobRecord['phase'];
  readonly acceptedAtMs: number;
  readonly containerStartedAtMs: number | null;
  readonly steps: JobRecord['steps'];
  readonly result: JobRecord['result'];
  readonly reported: boolean;
  readonly containerGone: boolean | null;
  readonly containerRunning: boolean;
};

export class ActionsJobContainer extends Container<Env> {
  override defaultPort = RUNNER_PORT;
  override sleepAfter = SLEEP_AFTER;
  override enableInternet = true;
  readonly #log: Logger;
  readonly #lifecycle: JobLifecycle;

  static {
    this.outboundByHost = { [EXECUTOR_HOST]: answerExecutor };
    this.outboundHandlers = { forge: answerForgeHost };
  }

  constructor(ctx: Container<Env>['ctx'], env: Env) {
    super(ctx, env);
    const config = readConfig(env);
    this.#log = createLogger(config.logLevel, {
      component: 'actions-job',
      instance: ctx.id.toString(),
    });
    this.envVars = {
      PORT: String(RUNNER_PORT),
      EXECUTOR_URL: `http://${EXECUTOR_HOST}`,
      RUST_LOG: config.logLevel,
    };
    this.#lifecycle = new JobLifecycle({
      load: async () => ctx.storage.get<JobRecord>(RECORD_KEY),
      save: async (record) => ctx.storage.put(RECORD_KEY, record),
      container: this.#port(),
      sink: (spec) => sinkFor(spec, env, config.sinkMode),
      schedule: async (delayMs, task) => {
        await this.schedule(Math.ceil(delayMs / 1000), taskMethod(task));
      },
      now: () => Date.now(),
      log: this.#log,
      executorRef: ctx.id.toString(),
    });
  }

  /** RPC from the entrypoint's `startJob`. */
  async accept(spec: JobSpec): Promise<JobHandle> {
    return this.#lifecycle.accept(spec);
  }

  /** RPC from the entrypoint's `cancelJob`; null when this object never had a job. */
  async cancel(reason: StopReason): Promise<{ readonly stopping: boolean } | null> {
    return this.#lifecycle.cancel(reason);
  }

  /** RPC from the `executor.internal` handler: the runner's JSON body in, the answer's out. */
  async fromRunner(
    path: string,
    text: string,
  ): Promise<{ readonly status: number; readonly body: string }> {
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      return { status: 400, body: JSON.stringify({ error: 'not JSON' }) };
    }
    const answer = await this.#lifecycle.fromRunner(path, body);
    return { status: answer.status, body: JSON.stringify(answer.body) };
  }

  /** The job's record without its spec (so without its tokens), as JSON for the admin route. */
  async describe(): Promise<string | null> {
    const record = await this.ctx.storage.get<JobRecord>(RECORD_KEY);
    if (record === undefined) return null;
    const summary: JobSummary = {
      jobId: record.spec.jobId,
      repo: record.spec.repo.fullName,
      jobName: record.spec.jobName,
      phase: record.phase,
      acceptedAtMs: record.acceptedAtMs,
      containerStartedAtMs: record.containerStartedAtMs,
      steps: record.steps,
      result: record.result,
      reported: record.reported,
      containerGone: record.containerGone,
      containerRunning: this.ctx.container?.running ?? false,
    };
    return JSON.stringify(summary);
  }

  // Scheduled tasks (called by name through `schedule`).
  async launchTask(): Promise<void> {
    await this.#lifecycle.launch();
  }

  async watchdogTask(): Promise<void> {
    await this.#lifecycle.onWatchdog();
  }

  async timeoutTask(): Promise<void> {
    await this.#lifecycle.onTimeout();
  }

  async forceStopTask(): Promise<void> {
    await this.#lifecycle.onForceStop();
  }

  async reportTask(): Promise<void> {
    await this.#lifecycle.onReport();
  }

  override onStart(): void {
    this.#log.info('job container started');
  }

  override async onStop(params: StopParams): Promise<void> {
    this.#log.info('job container stopped', { ...params });
    await this.#lifecycle.onContainerStopped(params);
  }

  override onError(error: unknown): unknown {
    this.#log.error('job container failed', { error });
    return error;
  }

  /** A job container never idles into a sleep mid-job: the watchdog decides when it is lost. */
  override async onActivityExpired(): Promise<void> {
    const record = await this.ctx.storage.get<JobRecord>(RECORD_KEY);
    if (record !== undefined && record.phase !== 'done') {
      this.renewActivityTimeout();
      return;
    }
    await this.destroy();
  }

  #port(): ContainerPort {
    return {
      start: async () => this.#startFresh(),
      post: async (path, body) =>
        this.containerFetch(`http://runner${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30_000),
        }),
      get: async (path) =>
        this.containerFetch(`http://runner${path}`, { signal: AbortSignal.timeout(10_000) }),
      destroy: async () => this.destroy(),
      isRunning: async () => this.ctx.container?.running ?? false,
      renew: () => this.renewActivityTimeout(),
    };
  }

  /** Starts the container with the job's `bs.internal` route; a capacity refusal is a value. */
  async #startFresh(): Promise<StartOutcome> {
    const record = await this.ctx.storage.get<JobRecord>(RECORD_KEY);
    if (record === undefined) throw new Error('no job to start a container for');
    const forge: ForgeJob = {
      repository: record.spec.repo.fullName,
      checkoutUrl: record.spec.checkout.url,
    };
    await this.setOutboundByHost(FORGE_HOST, 'forge', forge);
    try {
      await this.startAndWaitForPorts(RUNNER_PORT);
      return { kind: 'started' };
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      if (CAPACITY_MESSAGES.some((pattern) => pattern.test(text)))
        return { kind: 'no-capacity', reason: text };
      throw error;
    }
  }
}

function taskMethod(task: Task): string {
  switch (task) {
    case 'launch':
      return 'launchTask';
    case 'watchdog':
      return 'watchdogTask';
    case 'timeout':
      return 'timeoutTask';
    case 'force-stop':
      return 'forceStopTask';
    case 'report':
      return 'reportTask';
    default:
      return 'watchdogTask';
  }
}
