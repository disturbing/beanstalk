import { describe, expect, it } from 'vitest';

import { RunId } from '@beanstalk/shared-race/ids';
import type { BeanStreamSummary, GatewayRpc, RpcResult } from '@beanstalk/shared-race/rpc';

import type { GatewayBinding } from '@beanstalk/shared-ask/forge/gateway-rpc';
import { recordedRun } from '../recorded/recorded-runs';
import { liveEventStream } from './live-bridge';

const run = RunId.parse('j6boaclinn');

function fixtureEvents() {
  const recorded = recordedRun(run);
  if (recorded === undefined) throw new Error('the v2 fixture is missing');
  return recorded.events;
}

/** The gateway's live socket, as the binding's fetch hands it over (accepted by the bridge). */
class FakeSocket extends EventTarget {
  accepted = false;
  closed = false;

  accept(): void {
    this.accepted = true;
  }

  close(): void {
    this.closed = true;
  }

  push(message: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
  }
}

function ok<T>(value: T): Promise<RpcResult<T>> {
  return Promise.resolve({ ok: true, value });
}

function unused(): Promise<RpcResult<never>> {
  return Promise.resolve({ ok: false, error: { code: 'unused', status: 500, message: 'unused' } });
}

function fakeBinding(
  socket: FakeSocket,
  upTo: number,
  streams: readonly BeanStreamSummary[] = [],
): GatewayBinding<Fetcher> {
  const events = fixtureEvents().filter((event) => event.seq <= upTo);
  const rpc: GatewayRpc = {
    listRuns: () => Promise.resolve([]),
    runView: unused,
    runEvents: (_run, after, limit) => {
      const page = events.filter((event) => event.seq > after).slice(0, limit);
      return ok({
        events: page.map((event) => JSON.stringify(event)),
        next_after: page.at(-1)?.seq ?? after,
        done: false,
      });
    },
    decide: unused,
    viewToken: () =>
      ok({
        token: 'view-token',
        expires_at: '2026-10-04T12:00:00Z',
        live_path: `/v1/runs/${run}/live`,
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
    beanStreams: () => ok(streams),
    beanStream: () => ok(null),
  };
  return {
    ...rpc,
    fetch: (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      expect(url.searchParams.get('key')).toBe('view-token');
      const response = new Response(null, { status: 200 });
      Object.defineProperty(response, 'webSocket', { value: socket });
      return Promise.resolve(response);
    },
    connect: () => {
      throw new Error('the fake binding has no sockets');
    },
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

function sentSeqs(text: string): readonly number[] {
  return text
    .split('\n')
    .filter((line) => line.startsWith('data: ['))
    .flatMap((line) =>
      JSON.parse(line.slice('data: '.length)).map((event: { seq: number }) => event.seq),
    );
}

describe('the live bridge', () => {
  it('catches up from the log, then forwards the socket, once per event, until the run is done', async () => {
    const socket = new FakeSocket();
    const events = fixtureEvents();
    const stream = await liveEventStream({
      binding: fakeBinding(socket, 120),
      run,
      after: 100,
      signal: new AbortController().signal,
    });
    expect(socket.accepted).toBe(true);
    const reading = readAll(stream);
    await Promise.resolve();
    socket.push({
      type: 'update',
      view: { phase: 'running' },
      events: events.filter((event) => event.seq > 115 && event.seq <= 130),
    });
    socket.push({
      type: 'update',
      view: { phase: 'done' },
      events: events.filter((event) => event.seq > 130 && event.seq <= 135),
    });
    const text = await reading;
    const expected = events
      .filter((event) => event.seq > 100 && event.seq <= 135)
      .map((event) => event.seq);
    expect(sentSeqs(text)).toEqual(expected);
    expect(text).toContain('event: end');
    expect(socket.closed).toBe(true);
  });

  it('sends the beans streaming now after the catch-up, then each stream message, without ids', async () => {
    const socket = new FakeSocket();
    const writing: BeanStreamSummary = {
      type: 'bean.streaming',
      task: 't001',
      inv: 'inv0007-initial',
      agent: 'a0',
      seq: 3,
      t: 42,
      files: [{ path: 'src/cart.ts', status: 'modified', additions: 4, deletions: 1 }],
      additions: 4,
      deletions: 1,
      truncated: false,
      redacted: 0,
    };
    const stream = await liveEventStream({
      binding: fakeBinding(socket, 10, [writing]),
      run,
      after: 10,
      signal: new AbortController().signal,
    });
    const reading = readAll(stream);
    await Promise.resolve();
    socket.push({ type: 'stream', stream: { ...writing, seq: 4 } });
    socket.push({
      type: 'stream',
      stream: { type: 'bean.streaming.end', task: 't001', inv: writing.inv, t: 50 },
    });
    socket.push({ type: 'stream', stream: { type: 'bogus' } });
    socket.push({ type: 'update', view: { phase: 'done' }, events: [] });
    const text = await reading;
    const streamed = text
      .split('\n\n')
      .filter((block) => block.startsWith('event: stream'))
      .map((block) => JSON.parse(block.split('data: ')[1] ?? 'null'));
    expect(streamed.map((message) => [message.type, message.seq ?? null])).toEqual([
      ['bean.streaming', 3],
      ['bean.streaming', 4],
      ['bean.streaming.end', null],
    ]);
    expect(text).not.toMatch(/id: [^\n]*\nevent: stream/);
  });

  it('stops when the reader leaves', async () => {
    const socket = new FakeSocket();
    const reader = new AbortController();
    const stream = await liveEventStream({
      binding: fakeBinding(socket, 0),
      run,
      after: 0,
      signal: reader.signal,
    });
    const reading = readAll(stream);
    reader.abort();
    expect(await reading).toContain('event: end');
    expect(socket.closed).toBe(true);
  });
});
