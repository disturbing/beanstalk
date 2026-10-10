/**
 * Bridges a run's streaming diffs (`stream_diffs`, docs/claude-17-streaming-diffs.md) to the
 * browser: the gateway's stream socket (`/runs/:run/streams`, the run's RunStreamDO), reached
 * through the GATEWAY service binding, becomes a Server-Sent Events stream of `stream`
 * events. vinext cannot hold a WebSocket upgrade on its own routes. The bridge subscribes to
 * the beans on the reader's screen; every bean's summary and end arrive anyway. A patch that
 * does not follow the snapshot the bridge last forwarded (a socket the object dropped from
 * fan-out) is not forwarded: the bridge subscribes again and forwards the fresh snapshot.
 * Never in the event log, so the events carry no id.
 */
import type { RunId } from '@gitstalk/shared-race/ids';

import type { BeanStreamSocketMessage } from '@gitstalk/shared-ask/forge/bean-stream';
import { BeanStreamSocketMessage as MessageSchema } from '@gitstalk/shared-ask/forge/bean-stream';
import type { GatewayBinding } from '@gitstalk/shared-ask/forge/gateway-rpc';
import { ViewToken, unwrap } from '@gitstalk/shared-ask/forge/gateway-rpc';

/** A comment line keeps proxies from closing a quiet stream. */
const HEARTBEAT_MS = 20_000;

const encoder = new TextEncoder();
/** What the bridge holds for a bean after a gap, until the snapshot it asked for arrives. */
const AWAITING_SNAPSHOT = 'awaiting-snapshot';

export async function liveStreamFeed(input: {
  readonly binding: GatewayBinding<Fetcher>;
  readonly run: RunId;
  readonly beans: readonly string[];
  readonly signal: AbortSignal;
}): Promise<ReadableStream<Uint8Array>> {
  const socket = await openStreams(input.binding, input.run);
  return new ReadableStream<Uint8Array>({
    start: (controller) => pump({ socket, controller, beans: input.beans, signal: input.signal }),
    cancel: () => socket.close(1000, 'reader left'),
  });
}

/**
 * What the bridge forwards of one socket message, and whether it must subscribe again: the
 * seq it holds per subscribed bean decides whether a patch follows on.
 */
export function relay(
  held: Map<string, string>,
  data: unknown,
): { readonly forward: BeanStreamSocketMessage | null; readonly resubscribe: boolean } {
  const message = parseMessage(data);
  if (message === null) return { forward: null, resubscribe: false };
  if (message.type === 'bean.snapshot') {
    held.set(message.task, `${message.inv}:${message.seq}`);
    return { forward: message, resubscribe: false };
  }
  if (message.type === 'bean.streaming.end') held.delete(message.task);
  if (message.type !== 'bean.patch') return { forward: message, resubscribe: false };
  const holding = held.get(message.task);
  const follows = message.base_seq === 0 || holding === `${message.inv}:${message.base_seq}`;
  if (!follows) {
    // One request per gap: later patches wait for the snapshot it brings.
    held.set(message.task, AWAITING_SNAPSHOT);
    return { forward: null, resubscribe: holding !== AWAITING_SNAPSHOT };
  }
  held.set(message.task, `${message.inv}:${message.seq}`);
  return { forward: message, resubscribe: false };
}

async function openStreams(binding: GatewayBinding<Fetcher>, run: RunId): Promise<WebSocket> {
  const token = unwrap(await binding.viewToken(run), ViewToken);
  const url = `https://gateway.internal/runs/${run}/streams?key=${encodeURIComponent(token.token)}`;
  const response = await binding.fetch(new Request(url, { headers: { Upgrade: 'websocket' } }));
  const socket = response.webSocket;
  if (socket === null) throw new Error(`the stream feed did not upgrade (HTTP ${response.status})`);
  socket.accept();
  return socket;
}

type Pump = {
  readonly socket: WebSocket;
  readonly controller: ReadableStreamDefaultController<Uint8Array>;
  readonly beans: readonly string[];
  readonly signal: AbortSignal;
};

/** Forwards the socket's messages until it closes or the reader leaves. */
function pump(input: Pump): void {
  const { socket, controller } = input;
  const held = new Map<string, string>();
  const subscribe = () => socket.send(JSON.stringify({ type: 'subscribe', beans: input.beans }));
  let closed = false;
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
  socket.addEventListener('message', (message) => {
    if (closed) return;
    const { forward, resubscribe } = relay(held, message.data);
    if (resubscribe) subscribe();
    if (forward !== null)
      controller.enqueue(encoder.encode(`event: stream\ndata: ${JSON.stringify(forward)}\n\n`));
  });
  socket.addEventListener('close', () => finish('the gateway closed the stream feed'));
  input.signal.addEventListener('abort', () => finish('the reader left'));
  if (input.beans.length > 0) subscribe();
}

function parseMessage(data: unknown): BeanStreamSocketMessage | null {
  if (typeof data !== 'string') return null;
  const parsed = MessageSchema.safeParse(jsonOrUndefined(data));
  return parsed.success ? parsed.data : null;
}

function jsonOrUndefined(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Not a stream message (a pong): nothing to forward.
    return undefined;
  }
}
