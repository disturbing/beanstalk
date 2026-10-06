import { DurableObject } from 'cloudflare:workers';

import { codexSetup } from '../agent/codex-provider';
import type { CodexSetup } from '../agent/codex-provider';
import { loggerFor, swarmConfig } from '../config';
import type { Logger } from '../log';
import type { Credential, MatchCreate } from './match-schema';
import { agentSpend, coldStarts, containerCost, overCap } from './match-state';
import type { AgentRecord, ColdStart, MatchPhase, MatchState } from './match-state';

/** How often the alarm checks caps, stuck starts and exits while a match is live. */
const TICK_MS = 15_000;
/** Containers that have not all said hello this long after the match was created: halt. */
const START_TIMEOUT_MS = 10 * 60 * 1000;
/** A ready match nobody released this long after it became ready: halt. */
const RELEASE_TIMEOUT_MS = 30 * 60 * 1000;
/** At most this many bytes of slot logs per match, and per shipped file. */
const LOG_LIMIT_BYTES = 64 * 1024 * 1024;
export const FILE_LIMIT_BYTES = 1024 * 1024;
/** A 401 from the gateway re-issues the slot tokens at most this often. */
const REISSUE_MIN_MS = 30_000;

export type MatchView = {
  readonly match: string;
  readonly state: MatchPhase;
  readonly reason: string | null;
  readonly gateway_run: string;
  readonly credential: Credential['mode'];
  readonly created_at: number;
  readonly released_at: number | null;
  readonly agents: readonly AgentRecord[];
  readonly cold_start_ms: ColdStart;
  readonly container_seconds: number;
  readonly usd: {
    readonly agents: number;
    readonly containers: number;
    readonly containers_upper: number;
    readonly cap: number | null;
  };
};

export type SlotConfigReply =
  | { readonly released: false; readonly halted: boolean; readonly reason: string | null }
  | {
      readonly released: true;
      readonly halted: false;
      readonly config: Readonly<Record<string, unknown>> & { readonly codex: CodexSetup };
    };

/** What a slot reports when its driver first runs. */
export type SlotHello = { readonly codexVersion: string | null; readonly harness: string | null };

export type ModelAccess =
  | { readonly ok: true; readonly credential: Credential; readonly holder: string }
  | { readonly ok: false; readonly reason: string };

/**
 * One per match: a gateway run whose agent slots run in this swarm's containers. Owns the
 * config handed to each slot, the start barrier (every container says hello, then one release
 * starts them together), the spend cap, the halt, and the slots' shipped logs and files.
 */
export class MatchDO extends DurableObject<Env> {
  readonly #log: Logger;
  #lastReissue = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#log = loggerFor(env, 'match');
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS log (id INTEGER PRIMARY KEY AUTOINCREMENT, slot TEXT NOT NULL, text TEXT NOT NULL)',
    );
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS files (slot TEXT NOT NULL, name TEXT NOT NULL, content BLOB NOT NULL, PRIMARY KEY (slot, name))',
    );
  }

  // ---- lifecycle ---------------------------------------------------------------------------------

  async create(match: string, body: MatchCreate): Promise<MatchView> {
    if (this.#state() !== null) throw new Error(`match ${match} exists`);
    const now = Date.now();
    const agents = Object.fromEntries(
      body.slots.map((s): [string, AgentRecord] => [s.slot, emptyAgent(s.slot)]),
    );
    const state: MatchState = {
      match,
      created_at: now,
      phase: 'starting',
      reason: null,
      gateway_run: body.gateway_run,
      credential: body.credential,
      max_usd: body.max_usd ?? null,
      driver: body.driver,
      agents,
      released_at: null,
      spend: {},
    };
    this.#save(state);
    await this.env.BROKER.get(this.env.BROKER.idFromName('broker')).matchStarted(match);
    await this.ctx.storage.setAlarm(now + TICK_MS);
    await Promise.all(body.slots.map((s) => this.#startAgent(state, s.slot, s.token)));
    this.#log.info('match created', {
      match,
      agents: body.slots.length,
      mode: body.credential.mode,
    });
    return this.view();
  }

  async #startAgent(state: MatchState, slot: string, token: string): Promise<void> {
    const agent = this.#agentStub(state.match, slot);
    const record = state.agents[slot];
    if (record === undefined) return;
    record.started_at = Date.now();
    this.#save(state);
    try {
      await agent.begin({ match: state.match, slot, run: state.gateway_run, token });
    } catch (error) {
      record.start_error = error instanceof Error ? error.message.slice(0, 300) : 'start failed';
      this.#save(state);
      this.#log.error('agent container failed to start', { match: state.match, slot, error });
    }
  }

  hello(slot: string, info: SlotHello): void {
    const state = this.#require();
    const agent = state.agents[slot];
    if (agent === undefined) return;
    agent.hello_at ??= Date.now();
    agent.codex_version = info.codexVersion;
    agent.harness = info.harness;
    if (agent.exited_at !== null) {
      // A stop before this hello was a failed start attempt that the container library retried
      // (seen on first starts): the container is alive, so it has not exited.
      agent.restarts += 1;
      agent.exited_at = null;
      agent.exit_code = null;
      agent.stop_reason = null;
    }
    if (
      state.phase === 'starting' &&
      Object.values(state.agents).every((a) => a.hello_at !== null)
    ) {
      state.phase = 'ready';
      this.#log.info('match ready', {
        match: state.match,
        cold_start: coldStarts(Object.values(state.agents)),
      });
    }
    this.#save(state);
  }

  /**
   * The shared start: every slot's next `GET /v1/config` returns its config. Refused (not
   * thrown: errors lose their class over RPC) unless every container has said hello.
   */
  release(): {
    readonly released: boolean;
    readonly reason: string | null;
    readonly view: MatchView;
  } {
    const state = this.#require();
    if (state.phase !== 'ready') {
      return { released: false, reason: `match is ${state.phase}, not ready`, view: this.view() };
    }
    state.phase = 'running';
    state.released_at = Date.now();
    this.#save(state);
    return { released: true, reason: null, view: this.view() };
  }

  slotConfig(slot: string): SlotConfigReply {
    const state = this.#require();
    if (state.phase === 'halted' || state.phase === 'done') {
      return { released: false, halted: true, reason: state.reason };
    }
    if (state.released_at === null) return { released: false, halted: false, reason: null };
    return {
      released: true,
      halted: false,
      config: {
        ...state.driver,
        slot,
        run: state.gateway_run,
        match: state.match,
        codex: codexSetup(state.credential),
      },
    };
  }

  modelAccess(slot: string): ModelAccess {
    const state = this.#require();
    if (state.phase !== 'running') return { ok: false, reason: `match is ${state.phase}` };
    if (overCap(state, Date.now())) return { ok: false, reason: 'the match reached its spend cap' };
    return { ok: true, credential: state.credential, holder: `${state.match}:${slot}` };
  }

  recordSpend(invocation: string, usd: number): void {
    const state = this.#state();
    if (state === null || !Number.isFinite(usd) || usd < 0) return;
    state.spend[invocation] = Math.max(state.spend[invocation] ?? 0, usd);
    this.#save(state);
  }

  slotExited(slot: string, code: number | null, reason: string | null = null): void {
    const state = this.#state();
    const agent = state?.agents[slot];
    if (state === null || agent === undefined) return;
    agent.exit_code ??= code;
    agent.exited_at ??= Date.now();
    agent.stop_reason ??= reason;
    if (
      state.phase === 'running' &&
      Object.values(state.agents).every((a) => a.exited_at !== null)
    ) {
      state.phase = 'done';
      state.reason = 'every slot exited';
    }
    this.#save(state);
  }

  async halt(reason: string): Promise<MatchView> {
    const state = this.#require();
    if (state.phase !== 'done' && state.phase !== 'halted') {
      state.phase = 'halted';
      state.reason = reason;
      this.#save(state);
      this.#log.warn('match halted', { match: state.match, reason });
      if (reason !== 'race over') await this.#stopGatewayRun(state, reason);
    }
    await Promise.all(
      Object.keys(state.agents).map((slot) =>
        this.#agentStub(state.match, slot)
          .halt()
          .catch((error: unknown) => this.#log.warn('agent halt failed', { slot, error })),
      ),
    );
    await this.env.BROKER.get(this.env.BROKER.idFromName('broker')).matchEnded(state.match);
    return this.view();
  }

  override async alarm(): Promise<void> {
    const state = this.#state();
    if (state === null) return;
    const now = Date.now();
    if (state.phase === 'done' || state.phase === 'halted') {
      await this.env.BROKER.get(this.env.BROKER.idFromName('broker')).matchEnded(state.match);
      return;
    }
    if (overCap(state, now)) {
      await this.halt(`spend cap $${state.max_usd} reached`);
      return;
    }
    if (state.phase === 'starting' && now - state.created_at > START_TIMEOUT_MS) {
      await this.halt('containers did not all start within 10 minutes');
      return;
    }
    if (state.phase === 'ready' && now - state.created_at > RELEASE_TIMEOUT_MS) {
      await this.halt('the match was never released');
      return;
    }
    await this.ctx.storage.setAlarm(now + TICK_MS);
  }

  // ---- gateway tokens ------------------------------------------------------------------------------

  /** After a 401 from the gateway: new slot tokens for every agent (needs GATEWAY_ADMIN_TOKEN). */
  async reissueTokens(): Promise<boolean> {
    const state = this.#require();
    const admin = swarmConfig(this.env).gatewayAdminToken;
    if (admin === null || Date.now() - this.#lastReissue < REISSUE_MIN_MS) return false;
    this.#lastReissue = Date.now();
    const response = await this.env.GATEWAY.fetch(
      `http://bs.internal/v1/runs/${state.gateway_run}/tokens`,
      { method: 'POST', headers: { authorization: `Bearer ${admin}` } },
    );
    if (!response.ok) {
      this.#log.warn('slot token re-issue refused', { status: response.status });
      return false;
    }
    const body: unknown = await response.json();
    const slots = slotTokens(body);
    await Promise.all(
      slots
        .filter((s) => state.agents[s.slot] !== undefined)
        .map((s) => this.#agentStub(state.match, s.slot).setToken(s.token)),
    );
    this.#log.info('slot tokens re-issued', { match: state.match, slots: slots.length });
    return true;
  }

  async #stopGatewayRun(state: MatchState, reason: string): Promise<void> {
    const admin = swarmConfig(this.env).gatewayAdminToken;
    if (admin === null) return;
    const response = await this.env.GATEWAY.fetch(
      `http://bs.internal/v1/runs/${state.gateway_run}/stop`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' },
        body: JSON.stringify({ reason: `swarm: ${reason}`.slice(0, 200) }),
      },
    );
    this.#log.info('gateway run stop requested', {
      run: state.gateway_run,
      status: response.status,
    });
  }

  // ---- slot logs and files --------------------------------------------------------------------------

  appendLog(slot: string, text: string): boolean {
    const used = this.ctx.storage.sql
      .exec<{ bytes: number | null }>('SELECT SUM(LENGTH(text)) AS bytes FROM log')
      .one().bytes;
    if ((used ?? 0) + text.length > LOG_LIMIT_BYTES) return false;
    this.ctx.storage.sql.exec('INSERT INTO log (slot, text) VALUES (?, ?)', slot, text);
    return true;
  }

  log(): string {
    return this.ctx.storage.sql
      .exec<{ text: string }>('SELECT text FROM log ORDER BY id')
      .toArray()
      .map((row) => row.text)
      .join('');
  }

  putFile(slot: string, name: string, content: ArrayBuffer): void {
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO files (slot, name, content) VALUES (?, ?, ?)',
      slot,
      name,
      content.slice(Math.max(0, content.byteLength - FILE_LIMIT_BYTES)),
    );
  }

  files(): readonly { slot: string; name: string; bytes: number }[] {
    return this.ctx.storage.sql
      .exec<{ slot: string; name: string; bytes: number }>(
        'SELECT slot, name, LENGTH(content) AS bytes FROM files ORDER BY slot, name',
      )
      .toArray();
  }

  file(slot: string, name: string): ArrayBuffer | null {
    const rows = this.ctx.storage.sql
      .exec<{ content: ArrayBuffer }>(
        'SELECT content FROM files WHERE slot = ? AND name = ?',
        slot,
        name,
      )
      .toArray();
    return rows[0]?.content ?? null;
  }

  // ---- views --------------------------------------------------------------------------------------

  exists(): boolean {
    return this.#state() !== null;
  }

  view(): MatchView {
    const state = this.#require();
    const agents = Object.values(state.agents);
    const cost = containerCost(agents, Date.now());
    return {
      match: state.match,
      state: state.phase,
      reason: state.reason,
      gateway_run: state.gateway_run,
      credential: state.credential.mode,
      created_at: state.created_at,
      released_at: state.released_at,
      agents,
      cold_start_ms: coldStarts(agents),
      container_seconds: cost.seconds,
      usd: {
        agents: agentSpend(state.spend),
        containers: cost.provisioned,
        containers_upper: cost.upper,
        cap: state.max_usd,
      },
    };
  }

  #agentStub(match: string, slot: string) {
    return this.env.AGENTS.get(this.env.AGENTS.idFromName(`${match}:${slot}`));
  }

  #state(): MatchState | null {
    return this.ctx.storage.kv.get<MatchState>('state') ?? null;
  }

  #require(): MatchState {
    const state = this.#state();
    if (state === null) throw new MatchStateError('no such match');
    return state;
  }

  #save(state: MatchState): void {
    this.ctx.storage.kv.put('state', state);
  }
}

export class MatchStateError extends Error {
  override readonly name = 'MatchStateError';
}

function emptyAgent(slot: string): AgentRecord {
  return {
    slot,
    started_at: null,
    hello_at: null,
    exited_at: null,
    exit_code: null,
    codex_version: null,
    harness: null,
    stop_reason: null,
    start_error: null,
    restarts: 0,
  };
}

function slotTokens(body: unknown): { slot: string; token: string }[] {
  if (typeof body !== 'object' || body === null) return [];
  const slots: unknown = Reflect.get(body, 'slots');
  if (!Array.isArray(slots)) return [];
  return slots.flatMap((item: unknown) => {
    if (typeof item !== 'object' || item === null) return [];
    const slot: unknown = Reflect.get(item, 'slot');
    const token: unknown = Reflect.get(item, 'token');
    return typeof slot === 'string' && typeof token === 'string' ? [{ slot, token }] : [];
  });
}
