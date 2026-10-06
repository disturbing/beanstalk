import { describe, expect, it } from 'vitest';

import { RunId } from '@beanstalk/shared-race/ids';
import type { GatewayRpc, RpcResult } from '@beanstalk/shared-race/rpc';

import type { GatewayBinding } from '@beanstalk/shared-ask/forge/gateway-rpc';
import { liveStreamFeed, relay } from './stream-bridge';

const run = RunId.parse('j6boaclinn');
const INV = 'inv0007-initial';

/** The gateway's stream socket, as the binding's fetch hands it over (accepted by the bridge). */
class FakeSocket extends EventTarget {
  accepted = false;
  closed = false;
  readonly sent: unknown[] = [];

  accept(): void {
    this.accepted = true;
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    this.closed = true;
  }

  push(message: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
  }

  end(): void {
    this.dispatchEvent(new Event('close'));
  }
}

function unused(): Promise<RpcResult<never>> {
  return Promise.resolve({ ok: false, error: { code: 'unused', status: 500, message: 'unused' } });
}

function fakeBinding(socket: FakeSocket, paths: string[]): GatewayBinding<Fetcher> {
  const rpc: GatewayRpc = {
    listRuns: () => Promise.resolve([]),
    runView: unused,
    runEvents: unused,
    decide: unused,
    viewToken: () =>
      Promise.resolve({
        ok: true,
        value: {
          token: 'view-token',
          expires_at: '2026-10-06T12:00:00Z',
          live_path: `/v1/runs/${run}/live`,
        },
      }),
    repoTree: unused,
    repoFile: unused,
    repoDiff: unused,
    repoLog: unused,
    repoGrep: unused,
    beansByPath: unused,
    beanDetail: unused,
    decisions: unused,
    testsFor: unused,
    verifyViewToken: unused,
    beanStreams: unused,
    beanStream: unused,
  };
  return {
    ...rpc,
    fetch: (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      paths.push(`${url.pathname}?${url.search.slice(1)}`);
      const response = new Response(null, { status: 200 });
      Object.defineProperty(response, 'webSocket', { value: socket });
      return Promise.resolve(response);
    },
    connect: () => {
      throw new Error('the fake binding has no sockets');
    },
  };
}

const FILE = {
  path: 'src/cart.ts',
  status: 'modified',
  additions: 1,
  deletions: 1,
  binary: false,
  patch: '@@ -1 +1 @@\n-a\n+b\n',
};

function snapshot(seq: number) {
  return { type: 'bean.snapshot', task: 't001', inv: INV, seq, files: [FILE] };
}

function patch(seq: number, baseSeq: number) {
  return {
    type: 'bean.patch',
    task: 't001',
    inv: INV,
    seq,
    base_seq: baseSeq,
    files: [FILE],
    removed: [],
  };
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  const chunks: string[] = [];
  // oxlint-disable-next-line no-await-in-loop -- a stream is read one chunk after another
  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    chunks.push(decoder.decode(next.value, { stream: true }));
  }
  return chunks.join('');
}

function streamed(text: string): readonly Record<string, unknown>[] {
  return text
    .split('\n\n')
    .filter((block) => block.startsWith('event: stream'))
    .map((block) => JSON.parse(block.split('data: ')[1] ?? 'null'));
}

describe('the stream bridge', () => {
  it('forwards a patch that follows the held snapshot, and a full one always', () => {
    const held = new Map<string, string>();

    const first = relay(held, JSON.stringify(snapshot(3)));
    const next = relay(held, JSON.stringify(patch(4, 3)));
    const full = relay(held, JSON.stringify(patch(9, 0)));

    expect([first, next, full].map((step) => step.forward?.type)).toEqual([
      'bean.snapshot',
      'bean.patch',
      'bean.patch',
    ]);
    expect(held.get('t001')).toBe(`${INV}:9`);
  });

  it('drops a patch that skips one and asks for the snapshot again, once', () => {
    const held = new Map([['t001', `${INV}:3`]]);

    const gap = relay(held, JSON.stringify(patch(6, 5)));
    const afterGap = relay(held, JSON.stringify(patch(7, 6)));

    expect(gap).toEqual({ forward: null, resubscribe: true });
    expect(afterGap).toEqual({ forward: null, resubscribe: false });
  });

  it('ignores what is not a stream message', () => {
    const held = new Map<string, string>();

    expect(relay(held, 'pong')).toEqual({ forward: null, resubscribe: false });
    expect(relay(held, JSON.stringify({ type: 'bogus' }))).toEqual({
      forward: null,
      resubscribe: false,
    });
  });

  it('subscribes to the reader’s beans, forwards stream events without ids, and resubscribes on a gap', async () => {
    const socket = new FakeSocket();
    const paths: string[] = [];
    const stream = await liveStreamFeed({
      binding: fakeBinding(socket, paths),
      run,
      beans: ['t001'],
      signal: new AbortController().signal,
    });
    const reading = readAll(stream);
    await Promise.resolve();
    const summary = {
      type: 'bean.streaming',
      task: 't001',
      inv: INV,
      agent: 'a0',
      seq: 3,
      t: 42,
      files: [{ path: 'src/cart.ts', status: 'modified', additions: 1, deletions: 1 }],
      additions: 1,
      deletions: 1,
      truncated: false,
      redacted: 0,
    };
    socket.push(summary);
    socket.push(snapshot(3));
    socket.push(patch(4, 3));
    socket.push(patch(6, 5));
    socket.push(snapshot(6));
    socket.push({ type: 'bean.streaming.end', task: 't001', inv: INV, t: 50 });
    socket.end();
    const text = await reading;

    expect(paths).toEqual([`/runs/${run}/streams?key=view-token`]);
    expect(socket.accepted).toBe(true);
    expect(socket.sent).toEqual([
      { type: 'subscribe', beans: ['t001'] },
      { type: 'subscribe', beans: ['t001'] },
    ]);
    expect(streamed(text).map((message) => [message['type'], message['seq'] ?? null])).toEqual([
      ['bean.streaming', 3],
      ['bean.snapshot', 3],
      ['bean.patch', 4],
      ['bean.snapshot', 6],
      ['bean.streaming.end', null],
    ]);
    expect(text).not.toContain('id: ');
    expect(text).toContain('event: end');
  });

  it('stops when the reader leaves', async () => {
    const socket = new FakeSocket();
    const reader = new AbortController();
    const stream = await liveStreamFeed({
      binding: fakeBinding(socket, []),
      run,
      beans: [],
      signal: reader.signal,
    });
    const reading = readAll(stream);
    reader.abort();

    expect(await reading).toContain('event: end');
    expect(socket.closed).toBe(true);
    expect(socket.sent).toEqual([]);
  });
});
