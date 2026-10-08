/**
 * A WebSocket's text frames as an async iterable, buffered from the moment it is wrapped, so a
 * reader can open the socket, read history, and then take every frame that arrived meanwhile.
 * The iterable ends when the socket closes or errors.
 */

/** The part of a WebSocket this needs (the Workers socket, or a fake in tests). */
export type FrameSource = {
  addEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void;
  addEventListener(type: 'close' | 'error', listener: () => void): void;
  close(code?: number, reason?: string): void;
};

export type SocketFrames = AsyncIterable<string> & { readonly close: () => void };

export function socketFrames(socket: FrameSource): SocketFrames {
  const queue: string[] = [];
  const waiting: ((next: IteratorResult<string>) => void)[] = [];
  let ended = false;
  const finish = () => {
    ended = true;
    for (const resolve of waiting.splice(0)) resolve({ done: true, value: undefined });
  };
  socket.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') return;
    const resolve = waiting.shift();
    if (resolve === undefined) queue.push(event.data);
    else resolve({ done: false, value: event.data });
  });
  socket.addEventListener('close', finish);
  socket.addEventListener('error', finish);
  return {
    close: () => {
      finish();
      socket.close(1000, 'reader left');
    },
    [Symbol.asyncIterator]: () => ({
      next: () => {
        const value = queue.shift();
        if (value !== undefined) return Promise.resolve({ done: false, value });
        if (ended) return Promise.resolve({ done: true, value: undefined });
        return new Promise((resolve) => waiting.push(resolve));
      },
    }),
  };
}
