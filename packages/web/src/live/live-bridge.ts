/**
 * Bridges a live run to the browser: the gateway's WebSocket feed, reached through the
 * GATEWAY service binding, becomes a Server-Sent Events stream. vinext cannot hold a
 * WebSocket upgrade on its own routes, and SSE reconnects by itself, resuming after the
 * last event id. Events missed before the socket opened are read with `runEvents` first.
 * Streaming diffs (`stream_diffs`) have their own feed (`stream-bridge.ts`).
 */
import { z } from 'zod';

import type { RunId } from '@gitstalk/shared-race/ids';

import { log } from '../log';
import type { GatewayBinding } from '@gitstalk/shared-ask/forge/gateway-rpc';
import { RunEventsPage, ViewToken, unwrap } from '@gitstalk/shared-ask/forge/gateway-rpc';
import type { RaceEvent } from '@gitstalk/shared-ask/race/race-events';
import { parseRaceEvents } from '@gitstalk/shared-ask/race/race-events';

/** A comment line keeps proxies from closing a quiet stream. */
const HEARTBEAT_MS = 20_000;
/** Events per catch-up page (the gateway's maximum). */
const CATCH_UP_PAGE = 5000;

const FeedMessage = z.object({
  type: z.string(),
  view: z.object({ phase: z.string() }).nullable().optional(),
  events: z.array(z.unknown()).optional(),
});

const encoder = new TextEncoder();

export async function liveEventStream(input: {
  readonly binding: GatewayBinding<Fetcher>;
  readonly run: RunId;
  readonly after: number;
  readonly signal: AbortSignal;
}): Promise<ReadableStream<Uint8Array>> {
  const socket = await openFeed(input.binding, input.run);
  return new ReadableStream<Uint8Array>({
    start: (controller) => pump({ ...input, socket, controller }),
    cancel: () => socket.close(1000, 'reader left'),
  });
}

async function openFeed(binding: GatewayBinding<Fetcher>, run: RunId): Promise<WebSocket> {
  const token = unwrap(await binding.viewToken(run), ViewToken);
  const url = `https://gateway.internal${token.live_path}?key=${encodeURIComponent(token.token)}`;
  const response = await binding.fetch(new Request(url, { headers: { Upgrade: 'websocket' } }));
  const socket = response.webSocket;
  if (socket === null) throw new Error(`the live feed did not upgrade (HTTP ${response.status})`);
  socket.accept();
  return socket;
}

type Pump = {
  readonly binding: GatewayBinding<Fetcher>;
  readonly run: RunId;
  readonly after: number;
  readonly signal: AbortSignal;
  readonly socket: WebSocket;
  readonly controller: ReadableStreamDefaultController<Uint8Array>;
};

/**
 * Buffers socket messages while catching up, then forwards everything newer than the last
 * event sent. Ends the stream when the run is done or the socket closes.
 */
async function pump(input: Pump): Promise<void> {
  const { socket, controller } = input;
  let lastSent = input.after;
  let caughtUp = false;
  let closed = false;
  const backlog: RaceEvent[] = [];
  const send = (events: readonly RaceEvent[]) => {
    const fresh = events.filter((event) => event.seq > lastSent);
    if (fresh.length === 0 || closed) return;
    lastSent = fresh.at(-1)?.seq ?? lastSent;
    controller.enqueue(
      encoder.encode(`id: ${lastSent}\nevent: events\ndata: ${JSON.stringify(fresh)}\n\n`),
    );
  };
  const finish = (reason: string) => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    controller.enqueue(encoder.encode(`event: end\ndata: ${JSON.stringify({ reason })}\n\n`));
    controller.close();
    socket.close(1000, reason);
  };
  const heartbeat = setInterval(() => {
    if (!closed) controller.enqueue(encoder.encode(': ping\n\n'));
  }, HEARTBEAT_MS);
  let done = false;
  socket.addEventListener('message', (message) => {
    const parsed = parseMessage(message.data);
    if (parsed === undefined) return;
    done ||= parsed.done;
    if (!caughtUp) {
      backlog.push(...parsed.events);
      return;
    }
    send(parsed.events);
    if (done) finish('the run is done');
  });
  socket.addEventListener('close', () => finish('the gateway closed the feed'));
  input.signal.addEventListener('abort', () => finish('the reader left'));
  try {
    send(await catchUp(input.binding, input.run, input.after));
  } catch (error: unknown) {
    // The socket still delivers new steps; the browser's next reconnect retries the catch-up.
    log.warn('live catch-up failed', { run: input.run, error });
  }
  caughtUp = true;
  send(backlog);
  if (done) finish('the run is done');
}

async function catchUp(
  binding: GatewayBinding<Fetcher>,
  run: RunId,
  after: number,
): Promise<readonly RaceEvent[]> {
  const events: RaceEvent[] = [];
  let cursor = after;
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop -- pages follow a cursor, one after another
    const page = unwrap(await binding.runEvents(run, cursor, CATCH_UP_PAGE), RunEventsPage);
    events.push(...parseRaceEvents(page.events).events);
    if (page.done || page.events.length === 0) return events;
    cursor = page.next_after;
  }
}

function parseMessage(
  data: unknown,
): { readonly events: readonly RaceEvent[]; readonly done: boolean } | undefined {
  if (typeof data !== 'string') return undefined;
  const message = FeedMessage.safeParse(jsonOrUndefined(data));
  if (!message.success) return undefined;
  return {
    events: parseRaceEvents(message.data.events ?? []).events,
    done: message.data.view?.phase === 'done',
  };
}

function jsonOrUndefined(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Not a feed message (a pong): nothing to forward.
    return undefined;
  }
}
