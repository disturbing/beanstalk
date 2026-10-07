/**
 * RunDO: one Durable Object per race. The shell around the engine: it feeds inputs (polls,
 * results, job outcomes, alarms) to `step()` one at a time, persists the state and events
 * of every step atomically, answers held long polls, runs the jobs the engine asks for,
 * and keeps the live feed's WebSockets up to date. It also guards spend: it meters the
 * infrastructure the run uses (`infra-meter`), aborts the run at `max_usd`, and deletes the
 * run's Artifacts repos once the final check is done (unless `keep_repo`).
 */
import { DurableObject } from 'cloudflare:workers';

import type {
  InvocationResult,
  NextResponse,
  InvocationProgress,
  ProgressResponse,
} from '@beanstalk/shared-race/driver';
import type { InvocationId, RunId, Sha, SlotId, TaskId } from '@beanstalk/shared-race/ids';
import type { RunConfig } from '@beanstalk/shared-race/run-config';
import {
  CONTINUOUS_SETTINGS,
  RunConfig as RunConfigSchema,
} from '@beanstalk/shared-race/run-config';

import type {
  BeanDetail,
  BeanSummary,
  DecisionRecord,
  RepoDiff,
  RepoFile,
  RepoGrep,
  RepoLog,
  RepoTree,
  RunView,
  TestCoverage,
} from '@beanstalk/shared-race/rpc';

import {
  BeanContextInput,
  BeanDiscoverInput,
  BeanSummariesInput,
  BeanInboxAckInput,
  BeanInboxReadInput,
  BeanThreadPostInput,
  BeanUpdateInput,
  ContributorTokenClaims,
} from '@beanstalk/shared-race/collaboration';
import type {
  BeanContext,
  BeanDiscoverPage,
  BeanPeerSummary,
  BeanInboxAckResult,
  BeanInboxPage,
  BeanThreadPostResult,
  BeanUpdateResult,
} from '@beanstalk/shared-race/collaboration';
import type {
  AffectedAnswer,
  AffectedQuery,
  ReadMapSummary,
  ReadMapTree,
} from '@beanstalk/shared-race/read-maps';
import type { RpcResult } from '@beanstalk/shared-race/rpc';

import {
  readBeanContext,
  readBeanInbox,
  readBeanSummaries,
  acknowledgeBeanInbox,
} from '../collaboration/read';
import { discoverBeans } from '../collaboration/discover';
import { migrateCollaboration, seedCollaboration, readBean } from '../collaboration/store';
import { updateBean } from '../collaboration/update';
import { postBeanThread } from '../collaboration/thread';

import type { ArtifactsPort, RepoRemote } from '../adapters/artifacts';
import { artifactsPort } from '../adapters/artifacts';
import type { RepoExplorer } from '../adapters/repo-explorer';
import { repoExplorer } from '../adapters/repo-explorer';
import type { EngineEnv } from '../engine/catalog';
import { engineEnv } from '../engine/catalog';
import { step } from '../engine/engine';
import { initialEngineState } from '../engine/lifecycle';
import type {
  EngineInput,
  EngineReply,
  EngineResponse,
  JobId,
  JobOutcome,
  JobSpec,
} from '../engine/model';
import { migrateReadMaps, recordCheck, sqlReadMapIndex } from '../read-maps/read-map-store';
import type { EngineState, StepOutput } from '../engine/state';
import { buildSummary } from '../engine/summary';
import { runView } from '../engine/view';
import { readConfig } from '../config';
import { GatewayError, UpstreamError } from '../errors';
import type { ObjectStore, RefMemo } from '../repo/object-cache';
import { cachedReader, sqlObjectStore } from '../repo/object-cache';
import type { Logger } from '../log';
import { createLogger } from '../log';
import type { RunnerPort } from '../runner/runner-client';
import { runnerPort } from '../runner/runner-client';
import { continuousRef } from '../push/bean-refs';
import type { PushBean, PushProgress } from '../push/push-bean';
import { listPushBeans, migratePushBeans, readPushBean, savePushBean } from '../push/push-bean';
import type { Submitted } from '../push/push-driver';
import { PushDriver } from '../push/push-driver';
import type { PushOptions } from '../push/push-intent';
import { pushIntent } from '../push/push-intent';
import type { OpenRepoEngineInput, RepoEngineRecord } from '../push/repo-engine';
import { RepoEngineRecord as RepoEngineSchema, beanLink } from '../push/repo-engine';
import { prepareRepoLines } from '../push/repo-lines';
import { StatusPublisher } from '../push/status-publisher';
import { toDriverReply } from './driver-reply';
import type { InfraMeter, InfraReport, RunnerCall } from './infra-meter';
import {
  countAlarm,
  countArtifactsOps,
  countRequest,
  emptyMeter,
  infraReport,
  recordRunnerCall,
  recordWarmStart,
} from './infra-meter';
import { meteredArtifacts, meteredRunner } from './metered-ports';
import type { GitAccess, GitPrincipal } from './git-access';
import { decideGitAccess } from './git-access';
import type { TokenSource } from './run-jobs';
import { cachingTokenSource, executeJob } from './run-jobs';
import { ciInstance, committerInstance, runRepoName } from './run-names';
import type { ReapMode, ReapOptions, ReapReport } from './run-reap';
import { reapRepos, repoStatus } from './run-reap';
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
import {
  clearObjectCache,
  hasRun,
  loadMeter,
  loadReapRecord,
  loadRun,
  migrate,
  readEvents,
  readEventsOfTypes,
  saveMeter,
  saveNewRun,
  saveConfig,
  saveReapRecord,
  saveStep,
} from './run-store';
import { runListItem, testCoverage } from './run-views';
import type { RunStreamDO } from '../stream/run-stream-do';
import { STREAM_SWEEP_MARGIN_S, streamChanges } from '../stream/stream-changes';
import type { StepWrite } from './step-writes';
import {
  COST_FLUSH_MS,
  SIZE_SAMPLE_STEPS,
  StepWriteError,
  classifyStep,
  sizeLevel,
  stateBytes,
  stepFingerprint,
} from './step-writes';

/** The run repo's branches (`refs/heads/sprout`, `refs/heads/stalk`). */
const SPROUT_BRANCH = 'sprout';
const STALK_BRANCH = 'stalk';
/** §4: a long poll is answered within 25 s, with `wait` if nothing came up. */
const POLL_TIMEOUT_MS = 25_000;
/** Reads of a pushed commit's message before the bean goes untitled, and the pause between. */
const COMMIT_READ_ATTEMPTS = 3;
/** Commits of a pushed head's history searched for its fork point on the sprout. */
const PUSH_HISTORY_LIMIT = 200;
const COMMIT_READ_PAUSE_MS = 300;
/** Where a continuous engine keeps the repository it drives (`push/repo-engine.ts`). */
const REPO_ENGINE_KEY = 'repo-engine';
/** Characters of a stack trace kept in an `error` event. */
const TRACEBACK_CHARS = 4000;
/**
 * Events after which a line has a new head (the base at the start, then landings on the
 * sprout or the stalk): the read index warms that head.
 */
const LINE_MOVES: ReadonlySet<string> = new Set([
  'race.start',
  'land',
  'revert',
  'sprout.reset',
  'green.promote',
]);
/** The infra meter is written with every stored step, and otherwise at most this often. */
const METER_SAVE_INTERVAL_MS = 5000;
/** How long `summary()` waits for a reap in flight, so a capture at `done` sees its outcome. */
const SUMMARY_REAP_WAIT_MS = 5000;

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
  #meter: InfraMeter;
  /** The read index: git objects by id (`repo/object-cache.ts`), and refs read moments ago. */
  #objects: ObjectStore;
  /** A sweep of a run this object never held deleted its storage; tables return on create. */
  #wiped = false;
  /** Fingerprint of the in-memory state for the quiet-step check (null: compute on demand). */
  #fingerprint: string | null = null;
  /** Since when a progress report's cost estimate is held in memory only (null: none is). */
  #unsavedCostSinceMs: number | null = null;
  /** Steps stored since the object woke, and the size warning last reached. */
  #stepsWritten = 0;
  #sizeLevel = 0;
  /** The meter changed since it was last stored, and when that was. */
  #meterDirty = false;
  #meterSavedAtMs = 0;
  /** The reap of the finished run, while it runs. */
  #reaping: Promise<void> | null = null;
  /** The run view the live feed last carried (JSON), to send it only when it changed. */
  #sentView: string | null = null;
  /** The explorer's parsed events, for the state seq they were read at. */
  #explorerCache: { readonly seq: number; readonly input: ExplorerInput } | null = null;
  readonly #refs: RefMemo = new Map();
  /** The warm-up of the line's head in progress, and whether the line moved again meanwhile. */
  #warming: Promise<void> | null = null;
  #warmAgain = false;
  /** `stream_diffs`: calls to the run's stream object, in step order (each after the last). */
  #streamCalls: Promise<void> = Promise.resolve();
  /** A continuous engine's driver: pushes in, verdicts out (`push/push-driver.ts`). */
  readonly #push: PushDriver;
  readonly #statuses: StatusPublisher;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const config = readConfig(env);
    this.#log = createLogger(config.logLevel, { component: 'run' });
    this.#meter = loadMeter(ctx.storage) ?? emptyMeter(Date.now());
    this.#artifacts = meteredArtifacts(artifactsPort(env.ARTIFACTS), () =>
      this.#setMeter(countArtifactsOps(this.#meter, 1)),
    );
    this.#runner = runnerPort((instance) =>
      meteredRunner(instance, env.RUNNER.getByName(instance), (call) => this.#recordRunner(call)),
    );
    this.#tokens = cachingTokenSource(this.#artifacts, {
      ttlSeconds: config.artifactsTokenTtlSeconds,
      now: () => Date.now(),
    });
    this.#objects = this.#migrate();
    migratePushBeans(ctx.storage.sql);
    this.#push = new PushDriver({
      sql: ctx.storage.sql,
      log: this.#log,
      apply: (input) => this.#applyStep(input),
      state: () => this.#requireLoaded().stored.state,
      config: () => this.#requireLoaded().stored.config,
      setConfig: (next) => this.#setConfig(next),
      link: (bean) => this.#beanLink(bean),
      publish: (bean) => this.#statuses.publish(bean),
    });
    this.#statuses = new StatusPublisher({
      target: async () => {
        const repo = this.#requireLoaded().stored.repos.repo;
        return { remote: repo.remote, token: await this.#tokens.token(repo.name, 'write') };
      },
      log: this.#log,
      waitUntil: (work) => this.ctx.waitUntil(work),
      published: (bean, status) => {
        const stored = readPushBean(ctx.storage.sql, bean);
        if (stored !== null) savePushBean(ctx.storage.sql, { ...stored, status });
      },
      now: () => Date.now(),
    });
    const stored = loadRun(ctx.storage);
    if (stored !== null) {
      seedCollaboration(ctx.storage.sql, stored.config.tasks);
      this.#resume(stored);
    }
  }

  /**
   * Opens the continuous engine of a repository (idempotent): the sprout and the stalk start
   * at the repo's default branch, and the engine runs the demo rules with no task list; beans
   * arrive by push. The repo itself is made elsewhere; this never creates or deletes one.
   */
  async openRepoEngine(
    input: OpenRepoEngineInput & { engineId: RunId; createdAtMs: number },
  ): Promise<RunResult<{ engineId: RunId; created: boolean; baseSha: Sha }>> {
    this.#countRequest();
    const existing = this.#repoEngine();
    const loaded = this.#loaded;
    if (loaded !== null) {
      if (existing?.artifactsRepo !== input.artifactsRepo)
        return failure('conflict', 409, `engine ${input.engineId} drives another repo`);
      const baseSha = loaded.stored.state.baseSha;
      if (baseSha === null) return failure('invalid_state', 409, 'the engine has not started');
      return { ok: true, value: { engineId: input.engineId, created: false, baseSha } };
    }
    if (this.#creating) return failure('conflict', 409, 'the engine is being opened');
    this.#creating = true;
    try {
      return await this.#createRepoEngine(input);
    } catch (error: unknown) {
      if (error instanceof GatewayError && !(error instanceof UpstreamError))
        return failure(error.code, runStatus(error.status), error.message);
      return upstreamFailure(error, 'opening the repository engine');
    } finally {
      this.#creating = false;
    }
  }

  async #createRepoEngine(
    input: OpenRepoEngineInput & { engineId: RunId; createdAtMs: number },
  ): Promise<RunResult<{ engineId: RunId; created: boolean; baseSha: Sha }>> {
    if (this.#wiped) {
      this.#objects = this.#migrate();
      this.#wiped = false;
    }
    const repo = await this.#artifacts.describeRepo(input.artifactsRepo);
    const token = await this.#tokens.token(repo.name, 'write');
    const baseSha = await prepareRepoLines(
      { remote: repo.remote, token },
      { baseBranch: input.settings?.base_branch ?? null, nowMs: input.createdAtMs },
    );
    const config = RunConfigSchema.parse({
      ...CONTINUOUS_SETTINGS,
      policy: 'beanstalk-v2',
      label: `${input.owner.handle}/${input.repoName}`,
      arena: 'repository',
      tasks: [],
      ...(input.settings?.suite === undefined ? {} : { suite: input.settings.suite }),
    });
    const record: RepoEngineRecord = {
      engineId: input.engineId,
      owner: input.owner,
      repoName: input.repoName,
      artifactsRepo: repo.name,
      beanUrl: input.settings?.bean_url ?? null,
    };
    const env = engineEnv(config);
    const stored: StoredRun = {
      meta: { run: input.engineId, createdAtMs: input.createdAtMs },
      config,
      repos: { repo },
      state: initialEngineState(env, input.createdAtMs),
    };
    saveNewRun(this.ctx.storage, stored);
    this.ctx.storage.kv.put(REPO_ENGINE_KEY, record);
    this.#loaded = { stored, env };
    this.#saveMeter();
    const started = this.#apply({
      kind: 'start',
      at: Date.now(),
      baseSha,
      labels: { out: `repo:${record.owner.handle}/${record.repoName}`, repo: repo.name },
    });
    if (started.kind === 'refused') return failure('invalid_state', 409, started.refusal.message);
    this.#log.info('repository engine opened', { engine: input.engineId, repo: repo.name });
    return { ok: true, value: { engineId: input.engineId, created: true, baseSha } };
  }

  /** The repository this continuous engine drives, or null for a race. */
  repoEngine(): RepoEngineRecord | null {
    this.#countRequest();
    return this.#repoEngine();
  }

  /** Lends a token for one git request of a repository engine (refs are the caller's to police). */
  async repoGitGrant(access: GitAccess): Promise<GitGrant> {
    this.#countRequest();
    const loaded = this.#loaded;
    if (loaded === null || this.#repoEngine() === null)
      return { ok: false, status: 404, message: 'no such repository' };
    const repo = loaded.stored.repos.repo;
    try {
      const token = await this.#tokens.token(repo.name, access);
      return { ok: true, upstream: repo.remote, token, refs: null };
    } catch (error: unknown) {
      this.#log.error('minting a git token failed', { repo: repo.name, error });
      return { ok: false, status: 502, message: 'could not open the repo' };
    }
  }

  /** Why a push to `bean` must be refused now (before it reaches the repo), or null. */
  pushRefusal(bean: TaskId): string | null {
    this.#countRequest();
    if (this.#repoEngine() === null) return 'not a repository engine';
    return this.#push.refusal(bean);
  }

  /** A push of `bean` reached the repo: it becomes a bean, or answers the bean's rework. */
  async submitPush(input: {
    bean: TaskId;
    head: Sha;
    actor: string;
    options: PushOptions;
  }): Promise<Submitted> {
    this.#countRequest();
    const loaded = this.#loaded;
    if (loaded === null) return { ok: false, reason: 'no such repository' };
    const repo = loaded.stored.repos.repo.name;
    const message = await this.#pushedMessage(repo, input.head);
    const history = await this.#artifacts
      .history(repo, input.head, PUSH_HISTORY_LIMIT)
      .catch((error: unknown) => {
        this.#log.warn('reading a pushed history failed', { head: input.head, error });
        return [];
      });
    return this.#push.submit({
      bean: input.bean,
      head: input.head,
      actor: input.actor,
      intent: pushIntent(message ?? '', input.options),
      history,
    });
  }

  /** What a push waiting on `bean` sees after line `after`. */
  pushProgress(bean: string, push: number, after: number): PushProgress | null {
    this.#countRequest();
    return this.#push.progress(bean, push, after);
  }

  /**
   * Closes a repository engine: it stops taking pushes (its race ends and records its final
   * check), and with `deleteRepo` its Artifacts repo is deleted (the repository is gone).
   */
  async closeRepoEngine(options: { deleteRepo: boolean }): Promise<RunResult<{ phase: string }>> {
    this.#countRequest();
    const loaded = this.#loaded;
    if (loaded === null || this.#repoEngine() === null) return notFound();
    if (loaded.stored.state.phase === 'running')
      this.#apply({ kind: 'stop', at: Date.now(), reason: 'repository engine closed' });
    if (options.deleteRepo) {
      try {
        await this.#artifacts.deleteRepo(loaded.stored.repos.repo.name);
        clearObjectCache(this.ctx.storage.sql);
        this.#refs.clear();
      } catch (error: unknown) {
        return upstreamFailure(error, 'deleting the repository');
      }
    }
    return { ok: true, value: { phase: this.#requireLoaded().stored.state.phase } };
  }

  /** Every pushed bean, as its status ref and the pushes see it. */
  pushedBeans(): readonly PushBean[] {
    this.#countRequest();
    return listPushBeans(this.ctx.storage.sql);
  }

  /** Creates the run: the run repo, then the engine state with every task pending. */
  async createRun(input: {
    run: RunId;
    config: RunConfig;
    createdAtMs: number;
  }): Promise<RunResult<RepoRemote>> {
    this.#countRequest();
    if (this.#loaded !== null || this.#creating)
      return failure('conflict', 409, `run ${input.run} exists`);
    this.#creating = true;
    if (this.#wiped) {
      this.#objects = this.#migrate();
      this.#wiped = false;
    }
    try {
      const repo = await this.#artifacts.createRepo(
        runRepoName(input.run),
        `beanstalk race ${input.run}: the sprout and the stalk`,
      );
      const env = engineEnv(input.config, sqlReadMapIndex(this.ctx.storage.sql));
      const stored: StoredRun = {
        meta: { run: input.run, createdAtMs: input.createdAtMs },
        config: input.config,
        repos: { repo },
        state: initialEngineState(env, input.createdAtMs),
      };
      saveNewRun(this.ctx.storage, stored);
      seedCollaboration(this.ctx.storage.sql, stored.config.tasks);
      this.#loaded = { stored, env };
      this.#saveMeter();
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

  /** Stable configured bean identity, independent of dispatch slots and engine status. */
  collaborationBeanExists(bean: string): boolean {
    return this.#loaded !== null && readBean(this.ctx.storage.sql, bean) !== null;
  }

  /** Read current agreements and a bounded, independently cursor-addressed history. */
  beanContext(input: BeanContextInput): RpcResult<BeanContext> {
    this.#countRequest();
    if (this.#loaded === null) return notFound();
    const parsed = BeanContextInput.safeParse(input);
    return parsed.success
      ? readBeanContext(this.ctx.storage.sql, parsed.data)
      : failure('invalid_request', 400, 'invalid bean context input');
  }

  /** Discover independently published approaches before an observed diff exists. */
  beanDiscover(input: BeanDiscoverInput): RpcResult<BeanDiscoverPage> {
    this.#countRequest();
    if (this.#loaded === null) return notFound();
    const parsed = BeanDiscoverInput.safeParse(input);
    return parsed.success
      ? discoverBeans(this.ctx.storage.sql, parsed.data)
      : failure('invalid_request', 400, 'invalid bean discovery input');
  }

  /** Excerpt-only peer summaries for bean_context; no history crosses the RPC boundary. */
  beanPeerSummaries(beans: readonly string[]): RpcResult<BeanPeerSummary[]> {
    this.#countRequest();
    if (this.#loaded === null) return notFound();
    const parsed = BeanSummariesInput.safeParse(beans);
    return parsed.success
      ? readBeanSummaries(this.ctx.storage.sql, parsed.data)
      : failure('invalid_request', 400, 'invalid bean summaries input');
  }

  beanUpdate(claims: ContributorTokenClaims, input: BeanUpdateInput): RpcResult<BeanUpdateResult> {
    this.#countRequest();
    const grant = this.#collaborationGrant(claims);
    if (!grant.ok) return grant;
    const parsed = BeanUpdateInput.safeParse(input);
    return parsed.success
      ? updateBean(this.ctx.storage, grant.value, parsed.data)
      : failure('invalid_request', 400, 'invalid bean update input');
  }

  beanThreadPost(
    claims: ContributorTokenClaims,
    input: BeanThreadPostInput,
  ): RpcResult<BeanThreadPostResult> {
    this.#countRequest();
    const grant = this.#collaborationGrant(claims);
    if (!grant.ok) return grant;
    const parsed = BeanThreadPostInput.safeParse(input);
    return parsed.success
      ? postBeanThread(this.ctx.storage, grant.value, parsed.data)
      : failure('invalid_request', 400, 'invalid thread post input');
  }

  beanInboxRead(
    claims: ContributorTokenClaims,
    input: BeanInboxReadInput,
  ): RpcResult<BeanInboxPage> {
    this.#countRequest();
    const grant = this.#collaborationGrant(claims);
    if (!grant.ok) return grant;
    const parsed = BeanInboxReadInput.safeParse(input);
    return parsed.success
      ? readBeanInbox(this.ctx.storage.sql, grant.value, parsed.data)
      : failure('invalid_request', 400, 'invalid inbox read input');
  }

  beanInboxAck(
    claims: ContributorTokenClaims,
    input: BeanInboxAckInput,
  ): RpcResult<BeanInboxAckResult> {
    this.#countRequest();
    const grant = this.#collaborationGrant(claims);
    if (!grant.ok) return grant;
    const parsed = BeanInboxAckInput.safeParse(input);
    return parsed.success
      ? acknowledgeBeanInbox(this.ctx.storage, grant.value, parsed.data)
      : failure('invalid_request', 400, 'invalid inbox acknowledgement input');
  }

  #collaborationGrant(claims: ContributorTokenClaims): RpcResult<ContributorTokenClaims> {
    if (this.#loaded === null) return notFound();
    const parsed = ContributorTokenClaims.safeParse(claims);
    if (
      !parsed.success ||
      parsed.data.run !== this.#loaded.stored.meta.run ||
      Date.parse(parsed.data.expires_at) <= Date.now()
    ) {
      return failure(
        'forbidden',
        403,
        'contributor capability does not match this run or has expired',
      );
    }
    if (!this.collaborationBeanExists(parsed.data.bean))
      return failure('not_found', 404, 'contributor bean does not exist');
    return { ok: true, value: parsed.data };
  }

  /** Starts the race from the arena base the admin seeded the sprout and the stalk with. */
  async start(): Promise<RunResult<{ baseSha: Sha }>> {
    this.#countRequest();
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
    if (response.kind === 'refused') return failure('invalid_state', 409, response.refusal.message);
    this.#prewarmRunners(loaded.stored.meta.run, loaded.env.config.ci_slots);
    return { ok: true, value: { baseSha: base.value } };
  }

  /**
   * Lists or deletes the run's Artifacts repos: every `race-<run>` and `race-<run>-*` repo
   * in the namespace, so repos of earlier gateways are found too. Refused while it races.
   */
  async reap(run: RunId, mode: ReapMode): Promise<RunResult<ReapReport>> {
    this.#countRequest();
    return this.#reap(run, { mode });
  }

  /**
   * The run index's sweep: deletes the run's repos when the run began before
   * `startedBeforeMs` (or is unknown here: orphaned repos) and is not racing. null: skipped.
   * `listed`: the namespace's repo names, when the run index listed them already.
   */
  async sweep(
    run: RunId,
    startedBeforeMs: number,
    listed?: readonly string[],
  ): Promise<RunResult<ReapReport | null>> {
    this.#countRequest();
    const createdAtMs = this.#loaded?.stored.meta.createdAtMs;
    if (createdAtMs !== undefined && createdAtMs >= startedBeforeMs)
      return { ok: true, value: null };
    return this.#reap(run, listed === undefined ? { mode: 'delete' } : { mode: 'delete', listed });
  }

  async #reap(run: RunId, options: ReapOptions): Promise<RunResult<ReapReport>> {
    if (this.#loaded?.stored.config.continuous === true)
      return failure('invalid_state', 409, 'a repository engine never deletes its repository');
    const phase = this.#creating ? 'being created' : this.#loaded?.stored.state.phase;
    if (phase === 'running' || phase === 'finishing' || phase === 'being created') {
      return failure('invalid_state', 409, `run is ${phase}; reap its repos once it is over`);
    }
    try {
      const report = await reapRepos(this.#artifacts, run, options);
      if (options.mode === 'delete') this.#reaped(run, report);
      await this.#forgetUnknownRun();
      return { ok: true, value: report };
    } catch (error: unknown) {
      return upstreamFailure(error, 'listing the namespace');
    }
  }

  /** Records a reap; once every repo is gone, the read index's cached objects go too. */
  #reaped(run: RunId, report: ReapReport): void {
    if (this.#loaded !== null) {
      saveReapRecord(this.ctx.storage, { ...report, atMs: Date.now() });
      if (report.failed.length === 0) {
        clearObjectCache(this.ctx.storage.sql);
        this.#refs.clear();
      }
    }
    // The run's streaming diffs go with its repos.
    if (this.#loaded?.stored.config.stream_diffs === true)
      this.#callStreams('clear', (streams) => streams.clear());
    this.#log.info('run repos reaped', {
      run,
      deleted: report.deleted.length,
      failed: report.failed.length,
    });
  }

  /**
   * A reap of a run this object never held (an orphaned repo's sweep) leaves no storage: the
   * tables the constructor made are deleted. A run created here later makes them again.
   */
  async #forgetUnknownRun(): Promise<void> {
    if (this.#loaded !== null || this.#creating || this.#wiped || hasRun(this.ctx.storage)) return;
    this.#wiped = true;
    await this.ctx.storage.deleteAll();
  }

  /** The admin answers a decision card (v2): which spec wins. */
  async decide(
    card: string,
    answer: { winner: string; actor: string; text: string | null },
  ): Promise<RunResult<{ accepted: true }>> {
    this.#countRequest();
    if (this.#loaded === null) return notFound();
    const response = this.#apply({ kind: 'decision', at: Date.now(), card, ...answer });
    return response.kind === 'refused'
      ? refusal(response)
      : { ok: true, value: { accepted: true } };
  }

  async stop(reason: string): Promise<RunResult<{ phase: string }>> {
    this.#countRequest();
    if (this.#loaded === null) return notFound();
    const response = this.#apply({ kind: 'stop', at: Date.now(), reason });
    if (response.kind === 'refused') return failure('invalid_state', 409, response.refusal.message);
    return { ok: true, value: { phase: this.#requireLoaded().stored.state.phase } };
  }

  /** The run view as JSON text (RPC returns text: the view is deep, recursive JSON). */
  async view(): Promise<RunResult<RunView>> {
    this.#countRequest();
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
    this.#countRequest();
    const input = this.#explorerInput();
    return input === null ? notFound() : { ok: true, value: beanSummaries(input, paths) };
  }

  /** One bean's story: status, agent, intent, files, checks, reworks, decisions. */
  async bean(id: string): Promise<RunResult<BeanDetail>> {
    this.#countRequest();
    const input = this.#explorerInput();
    if (input === null) return notFound();
    const detail = beanDetail(input, id);
    return detail === null
      ? failure('not_found', 404, `no bean ${id}`)
      : { ok: true, value: detail };
  }

  /** Decision cards, optionally only those touching `paths`. */
  async decisionRecords(paths: readonly string[] | null): Promise<RunResult<DecisionRecord[]>> {
    this.#countRequest();
    const input = this.#explorerInput();
    return input === null ? notFound() : { ok: true, value: decisionRecords(input, paths) };
  }

  /**
   * Acceptance tests whose static import closure covers `paths`, resolved on the run's
   * landed line (the sprout; the stalk for the queue).
   */
  async testsFor(paths: readonly string[]): Promise<RunResult<TestCoverage[]>> {
    this.#countRequest();
    const loaded = this.#loaded;
    if (loaded === null) return notFound();
    const { config, repos, state } = loaded.stored;
    const explorer = this.#explorer(repos.repo.name);
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

  /** What the run's read-map store holds (`read-maps/`). */
  async readMapSummary(): Promise<RunResult<ReadMapSummary>> {
    this.#countRequest();
    if (this.#loaded === null) return notFound();
    return { ok: true, value: sqlReadMapIndex(this.ctx.storage.sql).summary() };
  }

  /** The maps traced on one tree and its manifest. */
  async readMapTree(tree: string): Promise<RunResult<ReadMapTree>> {
    this.#countRequest();
    if (this.#loaded === null) return notFound();
    const view = sqlReadMapIndex(this.ctx.storage.sql).tree(tree);
    return view === null
      ? failure('not_found', 404, `no read maps of ${tree}`)
      : { ok: true, value: view };
  }

  /** The test files that may observe `query.changes`, from the run's read maps. */
  async readMapsAffected(query: AffectedQuery): Promise<RunResult<AffectedAnswer>> {
    this.#countRequest();
    if (this.#loaded === null) return notFound();
    return { ok: true, value: sqlReadMapIndex(this.ctx.storage.sql).affectedTests(query) };
  }

  /** The run repo's tree at a ref (one directory, or everything under it), via the read index. */
  async repoTree(ref: string, path: string, recursive: boolean): Promise<RunResult<RepoTree>> {
    return this.#explore((explorer) => explorer.tree(this.#repoRef(ref), path, recursive));
  }

  async repoFile(ref: string, path: string): Promise<RunResult<RepoFile>> {
    return this.#explore((explorer) => explorer.file(this.#repoRef(ref), path));
  }

  async repoDiff(
    from: string,
    to: string,
    paths: readonly string[] | null,
  ): Promise<RunResult<RepoDiff>> {
    return this.#explore((explorer) =>
      explorer.diff(this.#repoRef(from), this.#repoRef(to), paths),
    );
  }

  async repoLog(
    ref: string,
    paths: readonly string[] | null,
    limit: number,
  ): Promise<RunResult<RepoLog>> {
    return this.#explore((explorer) => explorer.log(this.#repoRef(ref), paths, limit));
  }

  async repoGrep(
    ref: string,
    pattern: string,
    paths: readonly string[] | null,
    regex = false,
  ): Promise<RunResult<RepoGrep>> {
    return this.#explore((explorer) =>
      explorer.grep(this.#repoRef(ref), pattern, paths, { regex }),
    );
  }

  /** `summary.json` of the run as JSON text. */
  async summary(): Promise<RunResult<string>> {
    this.#countRequest();
    if (this.#reaping !== null) await settledWithin(this.#reaping, SUMMARY_REAP_WAIT_MS);
    const loaded = this.#loaded;
    if (loaded === null) return notFound();
    this.#saveMeter();
    const { meta, config, state } = loaded.stored;
    const repos = repoStatus({
      done: state.phase === 'done',
      keepRepo: config.keep_repo,
      reaped: loadReapRecord(this.ctx.storage),
    });
    const summary = buildSummary(state, loaded.env, state.clock);
    return {
      ok: true,
      value: JSON.stringify({ ...summary, infra: this.#infra(meta.createdAtMs), repos }),
    };
  }

  /** How many agent slots the run has. */
  async agentCount(): Promise<RunResult<number>> {
    this.#countRequest();
    const loaded = this.#loaded;
    return loaded === null ? notFound() : { ok: true, value: loaded.stored.state.slots.length };
  }

  async events(after: number, limit: number): Promise<RunResult<EventsPage>> {
    this.#countRequest();
    const loaded = this.#loaded;
    if (loaded === null) return notFound();
    const rows = readEvents(this.ctx.storage.sql, after, limit);
    return {
      ok: true,
      value: {
        bodies: rows.map((row) => row.body),
        last: rows.at(-1)?.seq ?? after,
        // The run is over and this page reached the log's end: a reader may stop.
        done: loaded.stored.state.phase === 'done' && rows.length < limit,
      },
    };
  }

  /** The driver's long poll: an invocation as soon as there is one, else `wait` after 25 s. */
  async next(slot: SlotId, gitBase: string): Promise<RunResult<NextResponse>> {
    this.#countRequest();
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
    const response = this.#applyHeld({ kind: 'poll', at: Date.now(), slot, pollId });
    if (response?.kind === 'poll' && response.reply !== null)
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
    this.#countRequest();
    if (this.#loaded === null) return notFound();
    const response = this.#apply({ kind: 'result', at: Date.now(), slot, inv, result });
    return response.kind === 'refused'
      ? refusal(response)
      : { ok: true, value: { accepted: true } };
  }

  async progress(
    slot: SlotId,
    inv: InvocationId,
    report: InvocationProgress,
  ): Promise<RunResult<ProgressResponse>> {
    this.#countRequest();
    if (this.#loaded === null) return notFound();
    const response = this.#apply({
      kind: 'progress',
      at: Date.now(),
      slot,
      inv,
      costUsd: report.cost_usd,
      ...(report.files === undefined ? {} : { files: report.files }),
    });
    if (response.kind === 'refused') return refusal(response);
    return response.kind === 'progress'
      ? { ok: true, value: response.response }
      : { ok: true, value: { abort: false } };
  }

  /** Lends the gateway's Artifacts token for one git request, if the principal may make it. */
  async authorizeGit(principal: GitPrincipal, repo: string, access: GitAccess): Promise<GitGrant> {
    this.#countRequest();
    const loaded = this.#loaded;
    if (loaded === null) return { ok: false, status: 404, message: 'no such run' };
    const { repos, state } = loaded.stored;
    const decision = decideGitAccess({ principal, repo, access, repos, state });
    if (!decision.allowed) return { ok: false, status: decision.status, message: decision.message };
    const upstream = repos.repo;
    try {
      // A mint is counted by the metered Artifacts port; a cached token costs nothing.
      const token = await this.#tokens.token(repo, decision.scope);
      return { ok: true, upstream: upstream.remote, token, refs: decision.refs };
    } catch (error: unknown) {
      this.#log.error('minting a git token failed', { repo, error });
      return { ok: false, status: 502, message: 'could not open the repo' };
    }
  }

  /** The live feed: a hibernatable WebSocket that gets the view, then every step's events. */
  override async fetch(request: Request): Promise<Response> {
    this.#countRequest();
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('expected a WebSocket upgrade', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    const loaded = this.#loaded;
    const view = loaded === null ? null : runView(loaded.stored.state, loaded.env);
    server.send(JSON.stringify({ type: 'snapshot', view }));
    // The next update carries the view again, whatever the other viewers last got.
    this.#sentView = null;
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
    this.#setMeter(countAlarm(this.#meter, Date.now()));
    if (this.#loaded !== null) this.#apply({ kind: 'tick', at: Date.now() });
  }

  #resume(stored: StoredRun): void {
    this.#loaded = {
      stored,
      env: engineEnv(stored.config, sqlReadMapIndex(this.ctx.storage.sql)),
    };
    const phase = stored.state.phase;
    // A continuous engine's driver polls again after the restart (`#apply` drains it).
    if (phase === 'running' || phase === 'finishing')
      this.#apply({ kind: 'restart', at: Date.now() });
  }

  #requireLoaded(): Loaded {
    if (this.#loaded === null) throw new Error('the run is not loaded');
    return this.#loaded;
  }

  /**
   * One engine step, persisted with its events; then its effects. Synchronous: atomic. A
   * quiet step (`step-writes.ts`: poll bookkeeping, a cost estimate) stays in memory; its
   * state is written with the next step that changes something. A step that cannot be
   * stored throws `StepWriteError` and leaves the run as it was.
   */
  #apply(input: EngineInput): EngineResponse {
    const response = this.#applyStep(input);
    if (this.#loaded?.stored.config.continuous === true) this.#push.drain();
    return response;
  }

  /** `#apply` without the push driver's turn (the driver's own inputs come through here). */
  #applyStep(input: EngineInput): EngineResponse {
    const loaded = this.#requireLoaded();
    const output = this.#step(loaded, input);
    const before = loaded.stored.state;
    const { write, fingerprint } = classifyStep(
      input,
      output,
      () => this.#fingerprint ?? stepFingerprint(before),
    );
    this.#store(input, output, write);
    this.#loaded = { ...loaded, stored: { ...loaded.stored, state: output.state } };
    this.#fingerprint = fingerprint;
    if (write === 'state') {
      if (output.effects.events.some((event) => LINE_MOVES.has(event.type))) this.#lineMoved();
      this.#scheduleAlarm(output.state);
      this.#broadcast(output);
    }
    this.#reportStreams(output);
    if (output.effects.events.length > 0 && loaded.stored.config.continuous)
      this.#push.onEvents(output.effects.events);
    this.#deliver(output.effects.replies);
    for (const job of output.effects.jobs) this.ctx.waitUntil(this.#runJob(job.id, job.spec));
    if (write === 'state') this.#updateIndex();
    if (before.phase !== 'done' && output.state.phase === 'done') {
      this.#callStreams('finish', (streams) => streams.finish(output.state.clock));
      this.#finished();
    } else this.#enforceSpendCap();
    return output.response;
  }

  /**
   * `#apply` for a step that answers held polls: when the step cannot be stored, the polls
   * have been answered `wait` already, so the request returns instead of failing.
   */
  #applyHeld(input: EngineInput): EngineResponse | null {
    try {
      return this.#apply(input);
    } catch (error: unknown) {
      if (error instanceof StepWriteError) return null;
      throw error;
    }
  }

  /** Writes what the step needs: its state, events and the meter, or nothing yet. */
  #store(input: EngineInput, output: StepOutput, write: StepWrite): void {
    if (write === 'none') return;
    const nowMs = Date.now();
    if (write === 'cost') {
      this.#unsavedCostSinceMs ??= nowMs;
      if (nowMs - this.#unsavedCostSinceMs < COST_FLUSH_MS) return;
    }
    try {
      saveStep(this.ctx.storage, {
        state: output.state,
        events: output.effects.events,
        meter: this.#meter,
      });
    } catch (error: unknown) {
      this.#failedWrite(input, output.state, error);
    }
    this.#unsavedCostSinceMs = null;
    this.#meterDirty = false;
    this.#meterSavedAtMs = nowMs;
    this.#stepsWritten += 1;
    if (this.#stepsWritten % SIZE_SAMPLE_STEPS === 0) this.#watchSize(output.state);
  }

  /** A step could not be stored: say how large it was, answer every held poll, and throw. */
  #failedWrite(input: EngineInput, state: EngineState, error: unknown): never {
    const run = this.#loaded?.stored.meta.run;
    this.#log.error('storing a step failed', {
      run,
      input: input.kind,
      seq: state.seq,
      stateBytes: stateBytes(state),
      error,
    });
    this.#deliver([...this.#waiters.keys()].map((pollId) => ({ pollId, reply: { wait: true } })));
    throw new StepWriteError(`storing the ${input.kind} step of run ${run ?? '?'} failed`, {
      cause: error,
    });
  }

  /** Logs the state's size now and then, and warns when it reaches 1 MB, then 1.5 MB. */
  #watchSize(state: EngineState): void {
    const bytes = stateBytes(state);
    const level = sizeLevel(bytes);
    const fields = { run: this.#loaded?.stored.meta.run, seq: state.seq, stateBytes: bytes };
    if (level > this.#sizeLevel)
      this.#log.warn('run state is growing toward the 2 MB limit', fields);
    else this.#log.info('run state size', fields);
    this.#sizeLevel = level;
  }

  #countRequest(): void {
    this.#setMeter(countRequest(this.#meter, Date.now()));
  }

  #recordRunner(call: RunnerCall): void {
    this.#setMeter(recordRunnerCall(this.#meter, call));
  }

  /**
   * Kept in memory always; stored with every stored step, by `summary()`, and otherwise at
   * most every few seconds. Only a run stores it (a probe of an unknown run stores nothing).
   */
  #setMeter(meter: InfraMeter): void {
    this.#meter = meter;
    this.#meterDirty = true;
    if (Date.now() - this.#meterSavedAtMs >= METER_SAVE_INTERVAL_MS) this.#saveMeter();
  }

  #saveMeter(): void {
    if (this.#loaded === null || !this.#meterDirty) return;
    saveMeter(this.ctx.storage, this.#meter);
    this.#meterDirty = false;
    this.#meterSavedAtMs = Date.now();
  }

  /**
   * Starts the committer and the CI runner instances as the race starts, so the first squash
   * and check do not wait for a cold container. Best effort: a failure is logged and the
   * instance starts on its first call instead.
   */
  #prewarmRunners(run: RunId, ciSlots: number): void {
    const instances = [
      committerInstance(run),
      ...Array.from({ length: ciSlots }, (_, slot) => ciInstance(run, slot)),
    ];
    this.ctx.waitUntil(Promise.all(instances.map((instance) => this.#prewarm(instance))));
  }

  async #prewarm(instance: string): Promise<void> {
    const startMs = Date.now();
    try {
      await this.env.RUNNER.getByName(instance).start();
      this.#setMeter(recordWarmStart(this.#meter, { instance, startMs, endMs: Date.now() }));
    } catch (error: unknown) {
      this.#log.warn('pre-warming a runner failed', { instance, error });
    }
  }

  /** Creates the object's tables (idempotent) and returns the read index's store. */
  #migrate(): ObjectStore {
    const sql = this.ctx.storage.sql;
    migrate(sql);
    migrateCollaboration(sql);
    migrateReadMaps(sql);
    // The first design's snapshots lived here; the run's RunStreamDO holds them now.
    sql.exec('DROP TABLE IF EXISTS bean_streams');
    return sqlObjectStore(sql);
  }

  #infra(createdAtMs: number): InfraReport {
    return infraReport(this.#meter, createdAtMs);
  }

  /** `max_usd`: agent spend plus the metered infrastructure; reaching it aborts the run. */
  #enforceSpendCap(): void {
    const { meta, config, state } = this.#requireLoaded().stored;
    if (config.max_usd === null || state.phase !== 'running' || state.aborted !== null) return;
    const infraUsd = this.#infra(meta.createdAtMs).usd.total;
    const total = state.spent + infraUsd;
    if (total < config.max_usd) return;
    this.#log.warn('spend cap reached', { run: meta.run, total, maxUsd: config.max_usd });
    const reason = `budget (max_usd): $${total.toFixed(2)} of $${config.max_usd.toFixed(2)}, infra $${infraUsd.toFixed(2)}`;
    this.#apply({ kind: 'stop', at: Date.now(), reason });
  }

  /** The final check is done: log what the run cost and delete its repos. */
  #finished(): void {
    const { meta, config, state } = this.#requireLoaded().stored;
    this.#log.info('run cost', {
      run: meta.run,
      agentUsd: state.spent,
      infra: this.#infra(meta.createdAtMs),
    });
    if (config.keep_repo) return;
    const reaping = this.#reapFinished(meta.run).finally(() => {
      this.#reaping = null;
    });
    this.#reaping = reaping;
    this.ctx.waitUntil(reaping);
  }

  /** Never rejects: a failure is logged, and the summary reports the repos as still reaping. */
  async #reapFinished(run: RunId): Promise<void> {
    try {
      const reaped = await this.#reap(run, { mode: 'delete' });
      if (!reaped.ok) this.#log.warn('reaping a finished run failed', { run, error: reaped.error });
    } catch (error: unknown) {
      this.#log.error('reaping a finished run failed', { run, error });
    }
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

  /** The run repo's explorer, reading through the read index. */
  #explorer(repo: string): RepoExplorer {
    return repoExplorer(this.env.ARTIFACTS, repo, (handle) =>
      cachedReader(handle, { store: this.#objects, refs: this.#refs, now: () => Date.now() }),
    );
  }

  /** A read of the run repo for the web app: expected failures become values. */
  async #explore<T>(read: (explorer: RepoExplorer) => Promise<T>): Promise<RunResult<T>> {
    this.#countRequest();
    const loaded = this.#loaded;
    if (loaded === null) return notFound();
    try {
      return { ok: true, value: await read(this.#explorer(loaded.stored.repos.repo.name)) };
    } catch (error: unknown) {
      if (error instanceof UpstreamError) return upstreamFailure(error, 'reading the run repo');
      if (error instanceof GatewayError)
        return failure(error.code, runStatus(error.status), error.message);
      throw error;
    }
  }

  /**
   * A line moved: forget the refs read moments ago, and read the new head's objects into the
   * index in the background, so the next question finds them there. Reads only: the engine
   * never waits for it, and a failure costs only the warm-up.
   */
  #lineMoved(): void {
    this.#refs.clear();
    this.ctx.waitUntil(this.#warm());
  }

  #warm(): Promise<void> {
    if (this.#warming !== null) {
      this.#warmAgain = true;
      return this.#warming;
    }
    const warming = this.#warmLoop().finally(() => {
      this.#warming = null;
    });
    this.#warming = warming;
    return warming;
  }

  async #warmLoop(): Promise<void> {
    do {
      this.#warmAgain = false;
      // oxlint-disable-next-line no-await-in-loop -- one warm-up at a time, again if the line moved
      await this.#warmLine();
    } while (this.#warmAgain);
  }

  async #warmLine(): Promise<void> {
    const loaded = this.#loaded;
    if (loaded === null) return;
    const { config, repos } = loaded.stored;
    try {
      await this.#explorer(repos.repo.name).warm(
        config.policy === 'queue' ? STALK_BRANCH : SPROUT_BRANCH,
      );
    } catch (error: unknown) {
      this.#log.warn('read index warm-up failed', { run: loaded.stored.meta.run, error });
    }
  }

  /** The explorer's input; the event log is read and parsed once per new event. */
  #explorerInput(): ExplorerInput | null {
    const loaded = this.#loaded;
    if (loaded === null) return null;
    const { state } = loaded.stored;
    const cached = this.#explorerCache;
    if (cached !== null && cached.seq === state.seq) return { ...cached.input, state };
    const bodies = readEventsOfTypes(this.ctx.storage.sql, EXPLORER_EVENT_TYPES);
    const events = bodies.flatMap((body) => {
      const event = parseLogged(body);
      return event === null ? [] : [event];
    });
    const input = { state, env: loaded.env, events };
    this.#explorerCache = { seq: state.seq, input };
    return input;
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
      suite: loaded.env.config.suite,
      engine: loaded.env.config.continuous ? 'continuous' : 'race',
      readMaps: loaded.stored.config.read_maps,
    });
    this.#apply({ kind: 'job-done', at: Date.now(), jobId: id, outcome: this.#keepMaps(outcome) });
  }

  /**
   * Stores a check's read maps and tree manifest in the run's SQLite and hands the engine the
   * result without them (they would bloat its state), with `mappedTree` naming where they went.
   */
  #keepMaps(outcome: JobOutcome): JobOutcome {
    if (!outcome.ok || outcome.result.kind !== 'check') return outcome;
    const { readMaps, tree, ...check } = outcome.result.check;
    if (readMaps === undefined && tree === undefined) return outcome;
    const mappedTree = recordCheck(this.ctx.storage.sql, {
      tree: tree ?? null,
      readMaps: readMaps ?? null,
      atMs: Date.now(),
    });
    if (readMaps?.status === 'unavailable') {
      this.#log.warn('a traced check ran untraced', { reason: readMaps.reason ?? 'unknown' });
    }
    return {
      ok: true,
      result: {
        kind: 'check',
        check: mappedTree === null ? check : { ...check, mappedTree },
      },
    };
  }

  #deliver(replies: readonly { pollId: string; reply: EngineReply }[]): void {
    for (const { pollId, reply } of replies) {
      if (PushDriver.isInternalPoll(pollId)) {
        this.#push.take(pollId, reply);
        continue;
      }
      const waiter = this.#waiters.get(pollId);
      if (waiter === undefined) continue;
      clearTimeout(waiter.timer);
      this.#waiters.delete(pollId);
      waiter.resolve(reply);
    }
  }

  #expirePoll(slot: SlotId, pollId: string): void {
    if (!this.#waiters.has(pollId)) return;
    this.#applyHeld({ kind: 'poll-expired', at: Date.now(), slot, pollId });
    // The engine no longer knew this poll (it was replaced): answer it here.
    this.#deliver([{ pollId, reply: { wait: true } }]);
  }

  #scheduleAlarm(state: EngineState): void {
    const next = Math.min(...Object.values(state.timers).map((timer) => timer.at));
    const at = Number.isFinite(next) ? Math.ceil(state.createdAtMs + next * 1000) : null;
    if (at === this.#alarmAt) return;
    this.#alarmAt = at;
    const change = at === null ? this.ctx.storage.deleteAlarm() : this.ctx.storage.setAlarm(at);
    this.ctx.waitUntil(
      change.catch((error: unknown) => {
        // Forget it, so the next step sets the alarm again.
        if (this.#alarmAt === at) this.#alarmAt = null;
        this.#log.error('scheduling the alarm failed', { at, error });
      }),
    );
  }

  #broadcast(output: StepOutput): void {
    if (output.effects.events.length === 0) return;
    const sockets = this.ctx.getWebSockets();
    if (sockets.length === 0) return;
    const loaded = this.#requireLoaded();
    const view = JSON.stringify(runView(output.state, loaded.env));
    const isNewView = view !== this.#sentView;
    this.#sentView = view;
    // The view is sent only when it changed (viewers keep the last one); events always are.
    const message = `{"type":"update",${isNewView ? `"view":${view},` : ''}"events":${JSON.stringify(output.effects.events)}}`;
    for (const socket of sockets) {
      try {
        socket.send(message);
      } catch (error: unknown) {
        // A socket that closed mid-send is dropped by the runtime; the others still get it.
        this.#log.debug('live socket send failed', { error });
      }
    }
  }

  /**
   * `stream_diffs`: tells the run's stream object which invocations this step started and
   * ended (the streaming kinds only), one batch each, from the step's events whether or not
   * the step was stored. The engine never waits for it; a failed call is logged and the
   * stream object's alarm sweep closes what it missed.
   */
  #reportStreams(output: StepOutput): void {
    const { config } = this.#requireLoaded().stored;
    if (!config.stream_diffs) return;
    const changes = streamChanges(
      output.effects.events,
      output.state.invocations,
      (config.agent_timeout + STREAM_SWEEP_MARGIN_S) * 1000,
    );
    if (changes.opens.length > 0)
      this.#callStreams('open', (streams) => streams.open(changes.opens));
    if (changes.closes.length > 0)
      this.#callStreams('close', (streams) => streams.close(changes.closes));
  }

  /** Runs `call` on the run's stream object after the calls before it (open, close, finish). */
  #callStreams(
    what: string,
    call: (streams: DurableObjectStub<RunStreamDO>) => Promise<void>,
  ): void {
    const run = this.#loaded?.stored.meta.run;
    if (run === undefined) return;
    const next = this.#streamCalls.then(() =>
      call(this.env.RUN_STREAMS.getByName(run)).catch((error: unknown) => {
        this.#log.warn('stream object call failed', { run, call: what, error });
      }),
    );
    this.#streamCalls = next;
    this.ctx.waitUntil(next);
  }

  /**
   * The pushed commit's message. Artifacts may not show a commit pushed moments ago yet, so a
   * miss is read again briefly; without it the bean is titled from the push options or untitled.
   */
  async #pushedMessage(repo: string, head: Sha): Promise<string | null> {
    for (let attempt = 0; attempt < COMMIT_READ_ATTEMPTS; attempt += 1) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- a miss is read again after a pause
        const message = await this.#artifacts.commitMessage(repo, head);
        if (message !== null) return message;
      } catch (error: unknown) {
        this.#log.warn('reading a pushed commit failed', { head, error });
      }
      // oxlint-disable-next-line no-await-in-loop -- Artifacts is eventually consistent
      await scheduler.wait(COMMIT_READ_PAUSE_MS);
    }
    return null;
  }

  #repoEngine(): RepoEngineRecord | null {
    const stored = this.ctx.storage.kv.get(REPO_ENGINE_KEY);
    if (stored === undefined) return null;
    const parsed = RepoEngineSchema.safeParse(stored);
    return parsed.success ? parsed.data : null;
  }

  #beanLink(bean: string): string | null {
    const record = this.#repoEngine();
    return record === null ? null : beanLink(record, bean);
  }

  /** A pushed bean's definition joined the run's tasks: persist it and rebuild the engine env. */
  #setConfig(config: RunConfig): void {
    const loaded = this.#requireLoaded();
    saveConfig(this.ctx.storage, config);
    this.#loaded = { stored: { ...loaded.stored, config }, env: engineEnv(config) };
  }

  /** A web ref as the repo holds it: a continuous engine's beans are `bean/<name>`. */
  #repoRef(ref: string): string {
    if (this.#loaded?.stored.config.continuous !== true || !ref.startsWith('beans/')) return ref;
    return continuousRef(`refs/heads/${ref}`).slice('refs/heads/'.length);
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

const RUN_STATUSES: ReadonlySet<number> = new Set([400, 403, 404, 409, 422]);

/** A gateway error's status, as a run result can carry it (anything else reads as 502). */
function runStatus(status: GatewayError['status']): RunFailure['status'] {
  return isRunStatus(status) ? status : 502;
}

function isRunStatus(status: number): status is RunFailure['status'] {
  return RUN_STATUSES.has(status);
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

/** Waits for `work` to settle, or `ms`, whichever comes first. */
async function settledWithin(work: Promise<void>, ms: number): Promise<void> {
  const { promise: timeout, resolve } = Promise.withResolvers<void>();
  const timer = setTimeout(resolve, ms);
  try {
    await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
