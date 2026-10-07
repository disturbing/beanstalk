/**
 * A WebSocket as a byte stream, for the test tunnel (`GET /tunnel`): a stack without a Spectrum
 * app is reached with `ssh -o ProxyCommand='node tunnel-client.mjs wss://…/tunnel'`, and every
 * byte after that is the same SSH connection Spectrum would deliver to `connect`.
 */
import type { Duplex } from './socket-pipe';

/** The accepted server end of a WebSocket pair as readable and writable byte streams. */
export function webSocketDuplex(socket: WebSocket): Duplex {
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      // Binary messages may arrive as Blobs (reading one is async), so chunks are queued in order.
      let queued = Promise.resolve();
      socket.addEventListener('message', (event) => {
        const data: unknown = event.data;
        queued = queued.then(async () => controller.enqueue(await messageBytes(data)));
      });
      socket.addEventListener('close', () => {
        try {
          controller.close();
        } catch {
          // Already closed by an error: nothing more to do.
        }
      });
      socket.addEventListener('error', () => controller.error(new Error('websocket error')));
    },
  });
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      socket.send(chunk);
    },
    close() {
      socket.close(1000, 'done');
    },
    abort() {
      socket.close(1011, 'aborted');
    },
  });
  return { readable, writable };
}

/** A message's bytes, whatever form the runtime delivered it in. */
async function messageBytes(data: unknown): Promise<Uint8Array> {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data))
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  throw new TypeError('unexpected websocket message');
}
