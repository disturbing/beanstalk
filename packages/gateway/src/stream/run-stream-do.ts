/**
 * RunStreamDO: one Durable Object per run, beside the RunDO, holding the run's streaming
 * diffs (`stream_diffs`, docs/claude-17-streaming-diffs.md). The RunDO opens and closes the
 * invocations that may stream (batched per engine step); the driver's posts land here, never
 * on the engine's object; viewers hold a hibernatable WebSocket that gets every bean's
 * summary and, for the beans it subscribed to, the snapshot and then each post's patch.
 * The decisions are pure (`stream-rules.ts`); this class reads, writes and sends.
 */
import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';

import type { StreamDelta, StreamResponse } from '@beanstalk/shared-race/driver';
import type {
  BeanStream,
  BeanStreamEnd,
  BeanStreamSnapshot,
  BeanStreamSocketMessage,
  BeanStreamSummary,
} from '@beanstalk/shared-race/rpc';

import { readConfig } from '../config';
import type { Logger } from '../log';
import { createLogger } from '../log';
import type { RunResult } from '../run/run-do';
import type { StoredBean } from './stream-rules';
import { decidePost, raceSeconds, summaryOf } from './stream-rules';
import type { StreamClose, StreamOpen, WriteCost } from './stream-store';
import {
  closeInvocation,
  deleteBean,
  expiredInvocations,
  finishRun,
  hasOpenInvocations,
  isStreamingRun,
  loadBean,
  loadBeans,
  loadFileStats,
  loadFiles,
  loadInvocation,
  migrateStreamStore,
  openInvocations,
  writePost,
} from './stream-store';

/** The alarm sweeps invocations whose close never arrived this often. */
const SWEEP_INTERVAL_MS = 60_000;
/** Beans one socket may subscribe to at once. */
const MAX_SUBSCRIBED = 32;

/** What a viewer's socket asks for: the beans whose patches it wants (replacing the last set). */
const ClientMessage = z.object({
  type: z.literal('subscribe'),
  beans: z.array(z.string().min(1).max(64)).max(MAX_SUBSCRIBED),
});

/** A socket's subscription, kept in its attachment so it survives hibernation. */
const Attachment = z.object({ beans: z.array(z.string()) });
type Attachment = z.infer<typeof Attachment>;

export class RunStreamDO extends DurableObject<Env> {
  readonly #log: Logger;
  /** Rows and patch bytes written by posts since the object woke (`writeStats`). */
  #written: { posts: number; rows: number; patchBytes: number } = {
    posts: 0,
    rows: 0,
    patchBytes: 0,
  };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#log = createLogger(readConfig(env).logLevel, { component: 'run-streams' });
    migrateStreamStore(ctx.storage.sql);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  /** The RunDO's step started invocations that may stream. */
  async open(opens: readonly StreamOpen[]): Promise<void> {
    const nowMs = Date.now();
    openInvocations(this.ctx.storage.sql, opens, nowMs);
    if ((await this.ctx.storage.getAlarm()) === null)
      await this.ctx.storage.setAlarm(nowMs + SWEEP_INTERVAL_MS);
  }

  /** The RunDO's step ended invocations: their snapshots are superseded by the commit (or nothing). */
  async close(closes: readonly StreamClose[]): Promise<void> {
    const sql = this.ctx.storage.sql;
    const nowMs = Date.now();
    for (const close of closes) {
      closeInvocation(sql, close, nowMs);
      this.#endBean(close.task, close.inv, close.t);
    }
  }

  /** A driver's post: kept and pushed, ignored, or refused (the route renders the refusal). */
  async post(slot: string, inv: string, delta: StreamDelta): Promise<RunResult<StreamResponse>> {
    const sql = this.ctx.storage.sql;
    const nowMs = Date.now();
    const invocation = loadInvocation(sql, inv);
    const bean = invocation === null ? null : loadBean(sql, invocation.task);
    const decision = decidePost({
      isStreamingRun: isStreamingRun(sql),
      invocation,
      bean,
      files: bean === null ? [] : loadFileStats(sql, bean.task),
      slot,
      inv,
      nowMs,
      delta,
    });
    if (decision.kind === 'refuse') return { ok: false, error: decision.refusal };
    if (decision.kind === 'ignore') return { ok: true, value: decision.response };
    const cost = writePost(sql, decision.write);
    this.#count(cost);
    this.#log.debug('stream post', {
      inv,
      seq: delta.seq,
      baseSeq: delta.base_seq,
      files: delta.files.length,
      removed: delta.removed.length,
      rows: cost.rows,
      patchBytes: cost.patchBytes,
    });
    this.#sendAll(decision.summary);
    this.#sendSubscribed(decision.patch.task, decision.patch);
    return { ok: true, value: decision.response };
  }

  /** Every bean streaming now, latest summary each. */
  async beanStreams(): Promise<BeanStreamSummary[]> {
    return this.#summaries();
  }

  /** A bean's latest snapshot with its patches, or null. */
  async beanStream(task: string): Promise<BeanStream | null> {
    const sql = this.ctx.storage.sql;
    const bean = loadBean(sql, task);
    if (bean === null) return null;
    return { summary: summaryOf(bean, loadFileStats(sql, task)), files: loadFiles(sql, task) };
  }

  /** The run is done: every stream ends, nothing stays but the closed invocations. */
  async finish(t: number): Promise<void> {
    const sql = this.ctx.storage.sql;
    const beans = loadBeans(sql);
    finishRun(sql, Date.now());
    for (const bean of beans) this.#sendAll(endOf(bean, t));
    await this.ctx.storage.deleteAlarm();
  }

  /** The run is reaped: the object keeps nothing, and its sockets close. */
  async clear(): Promise<void> {
    for (const socket of this.ctx.getWebSockets()) socket.close(1000, 'the run was reaped');
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  /** Rows and patch bytes the posts wrote since the object woke (the write-cost measure). */
  async writeStats(): Promise<{ posts: number; rows: number; patchBytes: number }> {
    return { ...this.#written };
  }

  /** A viewer's socket (the Worker verified its view token): every summary now, then updates. */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket')
      return new Response('expected a WebSocket upgrade', { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ beans: [] } satisfies Attachment);
    for (const summary of this.#summaries()) server.send(JSON.stringify(summary));
    return new Response(null, { status: 101, webSocket: client });
  }

  /** `{"type": "subscribe", "beans": [...]}` replaces the socket's set and sends their snapshots. */
  override async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;
    const parsed = ClientMessage.safeParse(jsonOrNull(message));
    if (!parsed.success) return;
    const beans = [...new Set(parsed.data.beans)];
    socket.serializeAttachment({ beans } satisfies Attachment);
    for (const task of beans) {
      const snapshot = this.#snapshot(task);
      if (snapshot !== null) send(socket, snapshot);
    }
  }

  override async webSocketClose(socket: WebSocket, code: number, reason: string): Promise<void> {
    socket.close(code, reason);
  }

  /** Sweeps invocations whose close never came (agent timeout plus a margin, set at the open). */
  override async alarm(): Promise<void> {
    const sql = this.ctx.storage.sql;
    const nowMs = Date.now();
    const expired = expiredInvocations(sql, nowMs);
    if (expired.length > 0) {
      this.#log.warn('closing streams whose close never came', { invocations: expired.length });
      const closes = expired.map((invocation) => ({
        inv: invocation.inv,
        task: invocation.task,
        t: raceSeconds(invocation, nowMs),
      }));
      await this.close(closes);
    }
    if (hasOpenInvocations(sql)) await this.ctx.storage.setAlarm(nowMs + SWEEP_INTERVAL_MS);
  }

  #summaries(): BeanStreamSummary[] {
    const sql = this.ctx.storage.sql;
    return loadBeans(sql).map((bean) => summaryOf(bean, loadFileStats(sql, bean.task)));
  }

  #snapshot(task: string): BeanStreamSnapshot | null {
    const sql = this.ctx.storage.sql;
    const bean = loadBean(sql, task);
    if (bean === null) return null;
    const { inv, seq } = bean;
    return { type: 'bean.snapshot', task, inv, seq, files: loadFiles(sql, task) };
  }

  /** Drops the bean's snapshot when it belongs to `inv`, and tells every viewer. */
  #endBean(task: string, inv: string, t: number): void {
    const sql = this.ctx.storage.sql;
    const bean = loadBean(sql, task);
    if (bean === null || bean.inv !== inv) return;
    deleteBean(sql, task);
    this.#sendAll(endOf(bean, t));
  }

  #count(cost: WriteCost): void {
    const written = this.#written;
    this.#written = {
      posts: written.posts + 1,
      rows: written.rows + cost.rows,
      patchBytes: written.patchBytes + cost.patchBytes,
    };
  }

  #sendAll(message: BeanStreamSocketMessage): void {
    const text = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) send(socket, text);
  }

  /**
   * A patch goes only to the sockets subscribed to its bean. A socket whose send fails is
   * dropped from patch fan-out until it subscribes again (and gets a fresh snapshot).
   */
  #sendSubscribed(task: string, message: BeanStreamSocketMessage): void {
    const text = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      if (!subscriptionOf(socket).beans.includes(task)) continue;
      if (!send(socket, text)) socket.serializeAttachment({ beans: [] } satisfies Attachment);
    }
  }
}

function endOf(bean: StoredBean, t: number): BeanStreamEnd {
  return { type: 'bean.streaming.end', task: bean.task, inv: bean.inv, t };
}

function subscriptionOf(socket: WebSocket): Attachment {
  const parsed = Attachment.safeParse(socket.deserializeAttachment());
  return parsed.success ? parsed.data : { beans: [] };
}

/** Sends; false when the socket refused it (closed mid-send: the runtime drops it). */
function send(socket: WebSocket, message: string | BeanStreamSocketMessage): boolean {
  try {
    socket.send(typeof message === 'string' ? message : JSON.stringify(message));
    return true;
  } catch {
    // A socket that closed mid-send is dropped by the runtime; the others still get it.
    return false;
  }
}

function jsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Not a client message (a stray frame): ignored.
    return null;
  }
}
