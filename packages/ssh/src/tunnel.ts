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
      socket.addEventListener('message', (event) => {
        const data = event.data;
        controller.enqueue(
          typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data),
        );
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
