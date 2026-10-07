/**
 * Two byte streams joined both ways, counted, with a hard time limit. Used for an inbound TCP
 * socket and the container's SSH port, and for the test tunnel.
 */

/** One direction's ends. */
export type Duplex = {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
};

export type PipeTotals = { readonly bytesIn: number; readonly bytesOut: number };

export type PipeOptions = {
  /** Aborts both directions (the connection's time limit). */
  readonly signal: AbortSignal;
  /** Called as bytes flow, so the container is not put to sleep under a live connection. */
  readonly onActivity: () => void;
};

/**
 * Pipes `client` to `server` and back until either side closes or `signal` fires. Never throws:
 * a reset connection is the normal way an SSH session ends.
 */
export async function pipeBothWays(
  client: Duplex,
  server: Duplex,
  options: PipeOptions,
): Promise<PipeTotals> {
  const counted = { bytesIn: 0, bytesOut: 0 };
  const toServer = counter((n) => {
    counted.bytesIn += n;
    options.onActivity();
  });
  const toClient = counter((n) => {
    counted.bytesOut += n;
    options.onActivity();
  });
  const pipeOptions = { signal: options.signal };
  await Promise.allSettled([
    client.readable.pipeThrough(toServer).pipeTo(server.writable, pipeOptions),
    server.readable.pipeThrough(toClient).pipeTo(client.writable, pipeOptions),
  ]);
  return counted;
}

function counter(seen: (bytes: number) => void): TransformStream<Uint8Array, Uint8Array> {
  return new TransformStream({
    transform(chunk, controller) {
      seen(chunk.byteLength);
      controller.enqueue(chunk);
    },
  });
}
