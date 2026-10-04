/**
 * RunDO: one Durable Object per race. The shell around the engine: it feeds inputs (polls,
 * results, job outcomes, alarms) to `step()` one at a time, persists the state and events
 * of every step atomically, answers held long polls, runs the jobs the engine asks for,
 * and keeps the live feed's WebSockets up to date.
 */
import { DurableObject } from 'cloudflare:workers';

import type {
  InvocationResult,
  NextResponse,
  ProgressResponse,
} from '@beanstalk/shared-race/driver';
import type { InvocationId, RunId, Sha, SlotId } from '@beanstalk/shared-race/ids';
import type { RunConfig } from '@beanstalk/shared-race/run-config';

import type {
  BeanDetail,
  BeanSummary,
  DecisionRecord,
  RunView,
  TestCoverage,
} from '@beanstalk/shared-race/rpc';

import type { ArtifactsPort, RepoRemote } from '../adapters/artifacts';
import { artifactsPort } from '../adapters/artifacts';
import { repoExplorer } from '../adapters/repo-explorer';
import type { EngineEnv } from '../engine/catalog';
import { engineEnv } from '../engine/catalog';
import { step } from '../engine/engine';
import { initialEngineState } from '../engine/lifecycle';
import type { EngineInput, EngineReply, EngineResponse, JobId, JobSpec } from '../engine/model';
import type { EngineState, StepOutput } from '../engine/state';
import { buildSummary } from '../engine/summary';
import { runView } from '../engine/view';
import { readConfig } from '../config';
import { UpstreamError } from '../errors';
import type { Logger } from '../log';
import { createLogger } from '../log';
import type { RunnerPort } from '../runner/runner-client';
import { runnerPort } from '../runner/runner-client';
import { toDriverReply } from './driver-reply';
import type { GitAccess, GitPrincipal } from './git-access';
import { decideGitAccess } from './git-access';
import type { TokenSource } from './run-jobs';
import { cachingTokenSource, executeJob } from './run-jobs';
import { runRepoName } from './run-names';
import type { ReapMode, ReapReport } from './run-reap';
import { reapRepos } from './run-reap';
import type { StoredRun } from './run-store';
import type { ExplorerInput } from './run-explorer';
import {
  EXPLORER_EVENT_TYPES,
  beanDetail,
  beanSummaries,
  decisionRecords,
  parseLogged,
} from './run-explorer';
import { RUN_INDEX_NAME } from './run-index';
import { loadRun, migrate, readEvents, readEventsOfTypes, saveNewRun, saveStep } from './run-store';
import { runListItem, testCoverage } from './run-views';

/** The run repo's branches (`refs/heads/sprout`, `refs/heads/stalk`). */
const SPROUT_BRANCH = 'sprout';
const STALK_BRANCH = 'stalk';
/** §4: a long poll is answered within 25 s, with `wait` if nothing came up. */
const POLL_TIMEOUT_MS = 25_000;
/** Characters of a stack trace kept in an `error` event. */
const TRACEBACK_CHARS = 4000;

export type RunFailure = {
  readonly code: string;
  readonly status: 400 | 403 | 404 | 409 | 422 | 502;
  readonly message: string;
};
export type RunResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RunFailure };

export type GitGrant =
  | {
      readonly ok: true;
      readonly upstream: string;
      readonly token: string;
      readonly refs: readonly string[] | null;
    }
  | { readonly ok: false; readonly status: 403 | 404 | 409 | 502; readonly message: string };

export type EventsPage = {
  readonly bodies: readonly string[];
  readonly last: number;
  readonly done: boolean;
};

type Waiter = { resolve: (reply: EngineReply) => void; timer: ReturnType<typeof setTimeout> };

type Loaded = { stored: StoredRun; env: EngineEnv };

export class RunDO extends DurableObject<Env> {
  #loaded: Loaded | null = null;
  /** The run index row last sent (without its time), to send only changes. */
  #indexed: string | null = null;
  #creating = false;
  #alarmAt: number | null = null;
  readonly #waiters = new Map<string, Waiter>();
  readonly #log: Logger;
  readonly #artifacts: ArtifactsPort;
  readonly #runner: RunnerPort;
  readonly #tokens: TokenSource;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const config = readConfig(env);
    this.#log = createLogger(config.logLevel, { component: 'run' });
    this.#artifacts = artifactsPort(env.ARTIFACTS);
    this.#runner = runnerPort((instance) => env.RUNNER.getByName(instance));
    this.#tokens = cachingTokenSource(this.#artifacts, {
      ttlSeconds: config.artifactsTokenTtlSeconds,
      now: () => Date.now(),
    });
    migrate(ctx.storage.sql);
    const stored = loadRun(ctx.storage);
    if (stored !== null) this.#resume(stored);
  }

  /** Creates the run: the run repo, then the engine state with every task pending. */
  async createRun(input: {
    run: RunId;
    config: RunConfig;
    createdAtMs: number;
  }): Promise<RunResult<RepoRemote>> {
    if (this.#loaded !== null || this.#creating)
      return failure('conflict', 409, `run ${input.run} exists`);
    this.#creating = true;
    try {
      const repo = await this.#artifacts.createRepo(
        runRepoName(input.run),
        `beanstalk race ${input.run}: the sprout and the stalk`,
      );
      const env = engineEnv(input.config);
      const stored: StoredRun = {
        meta: { run: input.run, createdAtMs: input.createdAtMs },
        config: input.config,
        repos: { repo },
        state: initialEngineState(env, input.createdAtMs),
      };
      saveNewRun(this.ctx.storage, stored);
      this.#loaded = { stored, env };
      this.#updateIndex();
      this.#log.info('run created', {
        run: input.run,
        repo: repo.name,
        tasks: input.config.tasks.length,
      });
      return { ok: true, value: repo };
    } catch (error: unknown) {
      return upstreamFailure(error, 'creating the run repo');
    } finally {
      this.#creating = false;
    }
  }

  /** Starts the race from the arena base the admin seeded the sprout and the stalk with. */
  async start(): Promise<RunResult<{ baseSha: Sha }>> {
    const loaded = this.#loaded;
    if (loaded === null) return notFound();
    if (loaded.stored.state.phase !== 'created')
      return failure('invalid_state', 409, `run is ${loaded.stored.state.phase}`);
    const repo = loaded.stored.repos.repo;
    const base = await this.#seededBase(repo.name);
    if (!base.ok) return base;
    const response = this.#apply({
      kind: 'start',
      at: Date.now(),
      baseSha: base.value,
      labels: { out: `cloud:${loaded.stored.meta.run}`, repo: repo.name },
    });
    return response.kind === 'refused'
      ? failure('invalid_state', 409, response.refusal.message)
      : { ok: true, value: { baseSha: base.value } };
  }

  /**
   * Lists or deletes the run's Artifacts repos: every `race-<run>` and `race-<run>-*` repo
   * in the namespace, so repos of earlier gateways are found too. Refused while it races.
   */
  async reap(run: RunId, mode: ReapMode): Promise<RunResult<ReapReport>> {
    const phase = this.#loaded?.stored.state.phase;
    if (phase === 'running' || phase === 'finishing') {
      return failure('invalid_state', 409, `run is ${phase}; reap its repos once it is over`);
    }
    try {
      const report = await reapRepos(this.#artifacts, run, mode);
      if (mode === 'delete') {
        this.#log.info('run repos reaped', {
          run,
          deleted: report.deleted.length,
          failed: report.failed.length,
        });
      }
      return { ok: true, value: report };
    } catch (error: unknown) {
      return upstreamFailure(error, 'listing the namespace');
    }
  }

  /** The admin answers a decision card (v2): which spec wins. */
  async decide(
    card: string,
    answer: { winner: string; actor: string; text: string | null },
  ): Promise<RunResult<{ accepted: true }>> {
    if (this.#loaded === null) return notFound();
    const response = this.#apply({ kind: 'decision', at: Date.now(), card, ...answer });
    return response.kind === 'refused'
      ? refusal(response)
      : { ok: true, value: { accepted: true } };
  }

  async stop(reason: string): Promise<RunResult<{ phase: string }>> {
    if (this.#loaded === null) return notFound();
    const response = this.#apply({ kind: 'stop', at: Date.now(), reason });
    if (response.kind === 'refused') return failure('invalid_state', 409, response.refusal.message);
    return { ok: true, value: { phase: this.#requireLoaded().stored.state.phase } };
  }

  /** The run view as JSON text (RPC returns text: the view is deep, recursive JSON). */
  async view(): Promise<RunResult<RunView>> {
    const loaded = this.#loaded;
    if (loaded === null) return notFound();
    const { meta, repos, state } = loaded.stored;
    return {
      ok: true,
      value: { run: meta.run, repo: repos.repo.name, ...runView(state, loaded.env) },
    };
  }

  /** Beans whose files lie under `paths` (all beans for none), from the event log. */
  async beans(paths: readonly string[]): Promise<RunResult<BeanSummary[]>> {
    const input = this.#explorerInput();
    return input === null ? notFound() : { ok: true, value: beanSummaries(input, paths) };
  }

  /** One bean's story: status, agent, intent, files, checks, reworks, decisions. */
  async bean(id: string): Promise<RunResult<BeanDetail>> {
    const input = this.#explorerInput();
    if (input === null) return notFound();
    const detail = beanDetail(input, id);
    return detail === null
      ? failure('not_found', 404, `no bean ${id}`)
      : { ok: true, value: detail };
  }

  /** Decision cards, optionally only those touching `paths`. */
  async decisionRecords(paths: readonly string[] | null): Promise<RunResult<DecisionRecord[]>> {
    const input = this.#explorerInput();
    return input === null ? notFound() : { ok: true, value: decisionRecords(input, paths) };
  }

  /**
   * Acceptance tests whose static import closure covers `paths`, resolved on the run's
   * landed line (the sprout; the stalk for the queue).
   */
  async testsFor(paths: readonly string[]): Promise<RunResult<TestCoverage[]>> {
    const loaded = this.#loaded;
    if (loaded === null) return notFound();
    const { config, repos, state } = loaded.stored;
    const explorer = repoExplorer(this.env.ARTIFACTS, repos.repo.name);
    try {
      const line = await explorer.resolve(config.policy === 'queue' ? 'stalk' : 'sprout');
      if (line === null) return failure('not_found', 404, 'the run repo has no landed line yet');
      const value = await testCoverage({
        explorer,
        commit: line.commit,
        state,
        env: loaded.env,
        paths,
      });
      return { ok: true, value };
    } catch (error: unknown) {
      return upstreamFailure(error, 'reading the run repo');
    }
  }

  /** `summary.json` of the run as JSON text. */
  async summary(): Promise<RunResult<string>> {
    const loaded = this.#loaded;
    if (loaded === null) return notFound();
    const state = loaded.stored.state;
    return { ok: true, value: JSON.stringify(buildSummary(state, loaded.env, state.clock)) };
  }

  /** How many agent slots the run has. */
  async agentCount(): Promise<RunResult<number>> {
    const loaded = this.#loaded;
    return loaded === null ? notFound() : { ok: true, value: loaded.stored.state.slots.length };
  }

  async events(after: number, limit: number): Promise<RunResult<EventsPage>> {
    const loaded = this.#loaded;
    if (loaded === null) return notFound();
    const rows = readEvents(this.ctx.storage.sql, after, limit);
    return {
      ok: true,
      value: {
        bodies: rows.map((row) => row.body),
        last: rows.at(-1)?.seq ?? after,
        done: loaded.stored.state.phase === 'done',
      },
    };
  }

  /** The driver's long poll: an invocation as soon as there is one, else `wait` after 25 s. */
  async next(slot: SlotId, gitBase: string): Promise<RunResult<NextResponse>> {
    const loaded = this.#loaded;
    if (loaded === null) return notFound();
    if (!loaded.stored.state.slots.some((candidate) => candidate.id === slot)) {
      return failure('unknown_slot', 404, `the run has no slot ${slot}`);
    }
    const pollId = crypto.randomUUID();
    const replied = new Promise<EngineReply>((resolve) => {
      const timer = setTimeout(() => this.#expirePoll(slot, pollId), POLL_TIMEOUT_MS);
      this.#waiters.set(pollId, { resolve, timer });
    });
    const response = this.#apply({ kind: 'poll', at: Date.now(), slot, pollId });
    if (response.kind === 'poll' && response.reply !== null)
      this.#deliver([{ pollId, reply: response.reply }]);
    const reply = await replied;
    const current = this.#requireLoaded().stored;
    return {
      ok: true,
      value: toDriverReply(reply, { repos: current.repos, gitBase }),
    };
  }

  async result(
    slot: SlotId,
    inv: InvocationId,
    result: InvocationResult,
  ): Promise<RunResult<{ accepted: true }>> {
    if (this.#loaded === null) return notFound();
    const response = this.#apply({ kind: 'result', at: Date.now(), slot, inv, result });
    return response.kind === 'refused'
      ? refusal(response)
      : { ok: true, value: { accepted: true } };
  }

  async progress(
    slot: SlotId,
    inv: InvocationId,
    costUsd: number,
  ): Promise<RunResult<ProgressResponse>> {
    if (this.#loaded === null) return notFound();
    const response = this.#apply({ kind: 'progress', at: Date.now(), slot, inv, costUsd });
    if (response.kind === 'refused') return refusal(response);
    return response.kind === 'progress'
      ? { ok: true, value: response.response }
      : { ok: true, value: { abort: false } };
  }

  /** Lends the gateway's Artifacts token for one git request, if the principal may make it. */
  async authorizeGit(principal: GitPrincipal, repo: string, access: GitAccess): Promise<GitGrant> {
    const loaded = this.#loaded;
    if (loaded === null) return { ok: false, status: 404, message: 'no such run' };
    const { repos, state } = loaded.stored;
    const decision = decideGitAccess({ principal, repo, access, repos, state });
    if (!decision.allowed) return { ok: false, status: decision.status, message: decision.message };
    const upstream = repos.repo;
    try {
      const token = await this.#tokens.token(repo, decision.scope);
      return { ok: true, upstream: upstream.remote, token, refs: decision.refs };
    } catch (error: unknown) {
      this.#log.error('minting a git token failed', { repo, error });
      return { ok: false, status: 502, message: 'could not open the repo' };
    }
  }

  /** The live feed: a hibernatable WebSocket that gets the view, then every step's events. */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('expected a WebSocket upgrade', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    const loaded = this.#loaded;
    const view = loaded === null ? null : runView(loaded.stored.state, loaded.env);
    server.send(JSON.stringify({ type: 'snapshot', view }));
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (message === 'ping') socket.send('pong');
  }

  override async webSocketClose(socket: WebSocket, code: number, reason: string): Promise<void> {
    socket.close(code, reason);
  }

  /** Engine timers (CI latency, retries, the wall clock) fire from the object's alarm. */
  override async alarm(): Promise<void> {
    this.#alarmAt = null;
    if (this.#loaded !== null) this.#apply({ kind: 'tick', at: Date.now() });
  }

  #resume(stored: StoredRun): void {
    this.#loaded = { stored, env: engineEnv(stored.config) };
    const phase = stored.state.phase;
    if (phase === 'running' || phase === 'finishing')
      this.#apply({ kind: 'restart', at: Date.now() });
  }

  #requireLoaded(): Loaded {
    if (this.#loaded === null) throw new Error('the run is not loaded');
    return this.#loaded;
  }

  /** One engine step, persisted with its events; then its effects. Synchronous: atomic. */
  #apply(input: EngineInput): EngineResponse {
    const loaded = this.#requireLoaded();
    const output = this.#step(loaded, input);
    saveStep(this.ctx.storage, output.state, output.effects.events);
    this.#loaded = { ...loaded, stored: { ...loaded.stored, state: output.state } };
    this.#scheduleAlarm(output.state);
    this.#broadcast(output);
    this.#deliver(output.effects.replies);
    for (const job of output.effects.jobs) this.ctx.waitUntil(this.#runJob(job.id, job.spec));
    this.#updateIndex();
    return output.response;
  }

  /** Tells the run index when the run's phase or task counts changed. */
  #updateIndex(): void {
    const loaded = this.#loaded;
    if (loaded === null) return;
    const item = runListItem(loaded.stored);
    const key = JSON.stringify(item);
    if (key === this.#indexed) return;
    this.#indexed = key;
    const index = this.env.RUN_INDEX.getByName(RUN_INDEX_NAME);
    this.ctx.waitUntil(
      index
        .upsert({ ...item, updated_at: new Date().toISOString() })
        .catch((error: unknown) => this.#log.warn('run index update failed', { error })),
    );
  }

  #explorerInput(): ExplorerInput | null {
    const loaded = this.#loaded;
    if (loaded === null) return null;
    const bodies = readEventsOfTypes(this.ctx.storage.sql, EXPLORER_EVENT_TYPES);
    const events = bodies.flatMap((body) => {
      const event = parseLogged(body);
      return event === null ? [] : [event];
    });
    return { state: loaded.stored.state, env: loaded.env, events };
  }

  #step(loaded: Loaded, input: EngineInput): StepOutput {
    try {
      return step(loaded.stored.state, input, loaded.env);
    } catch (error: unknown) {
      this.#log.error('engine step failed', {
        run: loaded.stored.meta.run,
        input: input.kind,
        error,
      });
      const message = error instanceof Error ? error.message : String(error);
      const traceback = error instanceof Error ? (error.stack ?? '').slice(-TRACEBACK_CHARS) : '';
      return step(
        loaded.stored.state,
        { kind: 'fault', at: input.at, where: input.kind, error: message, traceback },
        loaded.env,
      );
    }
  }

  async #runJob(id: JobId, spec: JobSpec): Promise<void> {
    const loaded = this.#requireLoaded();
    const outcome = await executeJob(spec, {
      run: loaded.stored.meta.run,
      artifacts: this.#artifacts,
      runner: this.#runner,
      tokens: this.#tokens,
      log: this.#log.with({ run: loaded.stored.meta.run, job: id }),
      repos: () => this.#requireLoaded().stored.repos,
    });
    this.#apply({ kind: 'job-done', at: Date.now(), jobId: id, outcome });
  }

  #deliver(replies: readonly { pollId: string; reply: EngineReply }[]): void {
    for (const { pollId, reply } of replies) {
      const waiter = this.#waiters.get(pollId);
      if (waiter === undefined) continue;
      clearTimeout(waiter.timer);
      this.#waiters.delete(pollId);
      waiter.resolve(reply);
    }
  }

  #expirePoll(slot: SlotId, pollId: string): void {
    if (!this.#waiters.has(pollId)) return;
    this.#apply({ kind: 'poll-expired', at: Date.now(), slot, pollId });
    // The engine no longer knew this poll (it was replaced): answer it here.
    this.#deliver([{ pollId, reply: { wait: true } }]);
  }

  #scheduleAlarm(state: EngineState): void {
    const next = Math.min(...Object.values(state.timers).map((timer) => timer.at));
    const at = Number.isFinite(next) ? Math.ceil(state.createdAtMs + next * 1000) : null;
    if (at === this.#alarmAt) return;
    this.#alarmAt = at;
    this.ctx.waitUntil(
      at === null ? this.ctx.storage.deleteAlarm() : this.ctx.storage.setAlarm(at),
    );
  }

  #broadcast(output: StepOutput): void {
    if (output.effects.events.length === 0) return;
    const sockets = this.ctx.getWebSockets();
    if (sockets.length === 0) return;
    const loaded = this.#requireLoaded();
    const message = JSON.stringify({
      type: 'update',
      view: runView(output.state, loaded.env),
      events: output.effects.events,
    });
    for (const socket of sockets) {
      try {
        socket.send(message);
      } catch (error: unknown) {
        // A socket that closed mid-send is dropped by the runtime; the others still get it.
        this.#log.debug('live socket send failed', { error });
      }
    }
  }

  /** The base both lines were seeded with; refused until the seed push put it on both. */
  async #seededBase(repo: string): Promise<RunResult<Sha>> {
    try {
      const [sprout, stalk] = await Promise.all([
        this.#artifacts.branchHead(repo, SPROUT_BRANCH),
        this.#artifacts.branchHead(repo, STALK_BRANCH),
      ]);
      if (sprout === null || stalk === null) {
        return failure(
          'repo_not_seeded',
          409,
          `push the arena base to refs/heads/sprout and refs/heads/stalk of ${repo} first (POST seed-token)`,
        );
      }
      if (sprout !== stalk) {
        return failure(
          'repo_not_seeded',
          409,
          `refs/heads/sprout (${sprout}) and refs/heads/stalk (${stalk}) must both point at the arena base`,
        );
      }
      return { ok: true, value: sprout };
    } catch (error: unknown) {
      return upstreamFailure(error, 'reading the run repo');
    }
  }
}

function failure(
  code: string,
  status: RunFailure['status'],
  message: string,
): { ok: false; error: RunFailure } {
  return { ok: false, error: { code, status, message } };
}

function notFound(): { ok: false; error: RunFailure } {
  return failure('not_found', 404, 'no such run');
}

function upstreamFailure(error: unknown, what: string): { ok: false; error: RunFailure } {
  if (error instanceof UpstreamError)
    return failure('upstream_failed', 502, `${what}: ${error.message}`);
  throw error;
}

const REFUSAL_STATUS: Readonly<Record<string, RunFailure['status']>> = {
  invalid_state: 409,
  unknown_invocation: 404,
  wrong_slot: 403,
  closed_invocation: 409,
  unknown_card: 404,
  invalid_winner: 422,
};

function refusal(response: Extract<EngineResponse, { kind: 'refused' }>): {
  ok: false;
  error: RunFailure;
} {
  const { code, message } = response.refusal;
  return failure(code, REFUSAL_STATUS[code] ?? 409, message);
}
