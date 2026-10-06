import { env, runInDurableObject } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CreatedRun, Next } from './helpers';
import { ADMIN, call, createRun, json, pushBase, slotToken } from './helpers';

const BASE = '3'.repeat(40);
const gateway = exports.default;

const PATCH = '@@ -0,0 +1,2 @@\n+export const total = 1;\n+export const tax = 2;\n';

/** A full snapshot (`base_seq: 0`) as the second design's driver posts it. */
function full(seq: number, extra: Record<string, unknown> = {}) {
  return {
    seq,
    base_seq: 0,
    files: [
      { path: 'src/t001.ts', status: 'added', additions: 2, deletions: 0, patch: PATCH },
      { path: 'logo.png', status: 'added', additions: 0, deletions: 0, binary: true },
    ],
    removed: [],
    trigger: 'Write',
    ...extra,
  };
}

function oneLine(path: string, line: number): Record<string, unknown> {
  return {
    path,
    status: 'modified',
    additions: 1,
    deletions: 1,
    patch: `@@ -${line},1 +${line},1 @@\n-old ${line}\n+new ${line}\n`,
  };
}

/** Date.now as the stream object reads it, moved on by the test (the 400 ms rate limit). */
let clock = Date.now();

function advance(ms: number): void {
  clock += ms;
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** A started run and slot a0's first invocation, open on the run's stream object. */
async function running(config: Record<string, unknown> = {}) {
  const run = await createRun({ agents: 1, stream_diffs: true, ...config });
  await pushBase(run, BASE);
  await call('POST', `/v1/runs/${run.run}/start`, { token: ADMIN });
  const token = slotToken(run, 'a0');
  const next = await json<Next>(
    await call('POST', `/v1/runs/${run.run}/agents/a0/next`, { token }),
  );
  const inv = next.invocation?.inv ?? '';
  expect(inv).not.toBe('');
  if (config['stream_diffs'] !== false) await untilOpen(run, inv);
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  return { run, token, inv };
}

/** The RunDO opens the invocation in the background (`waitUntil`): wait for it to land. */
async function untilOpen(run: CreatedRun, inv: string): Promise<void> {
  const stub = env.RUN_STREAMS.getByName(run.run);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    // oxlint-disable-next-line no-await-in-loop -- each look is one round trip to the object
    const rows = await runInDurableObject(stub, (_, state) =>
      state.storage.sql.exec('SELECT 1 FROM stream_invocations WHERE inv = ?', inv).toArray(),
    );
    if (rows.length > 0) return;
  }
  throw new Error(`${inv} never opened`);
}

function post(run: CreatedRun, inv: string, token: string, body: unknown) {
  return call('POST', `/v1/runs/${run.run}/invocations/${inv}/stream`, { token, body });
}

type Socket = { readonly messages: Record<string, unknown>[]; readonly socket: WebSocket };

/** The run's stream socket, as the web app's bridge holds it. */
async function openStreams(run: CreatedRun, beans: readonly string[] = []): Promise<Socket> {
  const response = await call('GET', `/runs/${run.run}/streams?key=${run.view.token}`, {
    headers: { upgrade: 'websocket' },
  });
  const socket = response.webSocket;
  if (socket === null) throw new Error(`no socket (${response.status})`);
  socket.accept();
  const messages: Record<string, unknown>[] = [];
  socket.addEventListener('message', (event) => {
    if (typeof event.data === 'string') messages.push(JSON.parse(event.data));
  });
  if (beans.length > 0) socket.send(JSON.stringify({ type: 'subscribe', beans }));
  await settle(run);
  return { messages, socket };
}

/** Lets the sockets deliver what the object sent (a round trip through the object). */
async function settle(run: CreatedRun): Promise<void> {
  await gateway.beanStreams(run.run);
  await gateway.beanStreams(run.run);
}

function ofType(socket: Socket, type: string): Record<string, unknown>[] {
  return socket.messages.filter((message) => message['type'] === type);
}

describe('streaming diffs', () => {
  it('keeps the latest snapshot per bean, serves it by RPC and sends every socket a summary', async () => {
    const { run, token, inv } = await running();
    const viewer = await openStreams(run);

    const first = await post(run, inv, token, full(1));
    await settle(run);

    expect(first.status).toBe(200);
    expect(await json(first)).toEqual({ accepted: true, seq: 1 });
    const stream = await gateway.beanStream(run.run, 't001');
    expect(stream).toMatchObject({
      ok: true,
      value: {
        summary: { type: 'bean.streaming', task: 't001', inv, agent: 'a0', seq: 1, additions: 2 },
        files: [
          { path: 'logo.png', binary: true, patch: null },
          { path: 'src/t001.ts', patch: PATCH },
        ],
      },
    });
    const streams = await gateway.beanStreams(run.run);
    expect(streams.ok && streams.value.map((s) => s.task)).toEqual(['t001']);
    expect(ofType(viewer, 'bean.streaming')).toEqual([
      expect.objectContaining({ task: 't001', seq: 1 }),
    ]);
    expect(ofType(viewer, 'bean.patch')).toEqual([]);
  });

  it('accepts a first-design snapshot without base_seq as a full one', async () => {
    const { run, token, inv } = await running();
    const { base_seq: _base, removed: _removed, ...old } = full(1);

    const answer = await post(run, inv, token, old);

    expect(await json(answer)).toEqual({ accepted: true, seq: 1 });
  });

  it('applies deltas, and ignores stale, too frequent and unanchored posts', async () => {
    const { run, token, inv } = await running();
    await post(run, inv, token, full(2));

    const again = await json(await post(run, inv, token, full(2)));
    const soon = await json(await post(run, inv, token, full(3)));
    advance(500);
    const unanchored = await json(
      await post(run, inv, token, { seq: 3, base_seq: 1, files: [oneLine('src/b.ts', 1)] }),
    );
    const delta = await json(
      await post(run, inv, token, {
        seq: 3,
        base_seq: 2,
        files: [oneLine('src/b.ts', 1)],
        removed: ['logo.png'],
      }),
    );

    expect(again).toEqual({ accepted: false, reason: 'stale', seq: 2 });
    expect(soon).toEqual({ accepted: false, reason: 'rate', seq: 2 });
    expect(unanchored).toEqual({ accepted: false, reason: 'resync', seq: 2 });
    expect(delta).toEqual({ accepted: true, seq: 3 });
    const stream = await gateway.beanStream(run.run, 't001');
    expect(stream.ok && stream.value?.files.map((file) => file.path)).toEqual([
      'src/b.ts',
      'src/t001.ts',
    ]);
    expect(stream.ok && stream.value?.summary).toMatchObject({ additions: 3, deletions: 1 });
  });

  it('redacts lines that look like secrets before anyone can read them', async () => {
    const { run, token, inv } = await running();
    const leaky = `@@ -0,0 +1,2 @@\n+const key = "sk-ant-api03-abcdefghijkl";\n+const ok = 1;\n`;

    await post(run, inv, token, {
      seq: 1,
      base_seq: 0,
      files: [{ path: 'src/t001.ts', status: 'added', additions: 2, deletions: 0, patch: leaky }],
    });

    const stream = await gateway.beanStream(run.run, 't001');
    const text = JSON.stringify(stream);
    expect(text).not.toContain('sk-ant-');
    expect(text).toContain('const ok = 1');
    expect(stream.ok && stream.value?.summary.redacted).toBe(1);
  });

  it('sends a subscriber the snapshot, then only what each post changed', async () => {
    const { run, token, inv } = await running();
    await post(run, inv, token, full(1));
    const watching = await openStreams(run, ['t001']);
    const elsewhere = await openStreams(run, ['t002']);

    advance(500);
    await post(run, inv, token, { seq: 2, base_seq: 1, files: [oneLine('src/t001.ts', 1)] });
    await settle(run);

    expect(ofType(watching, 'bean.snapshot')).toEqual([
      expect.objectContaining({ task: 't001', inv, seq: 1 }),
    ]);
    expect(ofType(watching, 'bean.patch')).toEqual([
      {
        type: 'bean.patch',
        task: 't001',
        inv,
        seq: 2,
        base_seq: 1,
        files: [
          expect.objectContaining({
            path: 'src/t001.ts',
            patch: expect.stringContaining('+new 1'),
          }),
        ],
        removed: [],
      },
    ]);
    expect(ofType(elsewhere, 'bean.patch')).toEqual([]);
    expect(ofType(elsewhere, 'bean.streaming').map((summary) => summary['seq'])).toEqual([1, 2]);
  });

  it('writes and pushes only the changed file of a 100-file stream, 50 times', async () => {
    const { run, token, inv } = await running();
    const paths = Array.from(
      { length: 100 },
      (_, index) => `src/f${String(index).padStart(3, '0')}.ts`,
    );
    await post(run, inv, token, {
      seq: 1,
      base_seq: 0,
      files: paths.map((path) => oneLine(path, 1)),
    });
    const watching = await openStreams(run, ['t001']);
    const streams = env.RUN_STREAMS.getByName(run.run);
    const before = await streams.writeStats();

    for (let seq = 2; seq <= 51; seq += 1) {
      advance(500);
      const path = paths[seq % paths.length] ?? '';
      // oxlint-disable-next-line no-await-in-loop -- posts of one invocation follow each other
      const answer = await post(run, inv, token, {
        seq,
        base_seq: seq - 1,
        files: [oneLine(path, seq)],
      });
      // oxlint-disable-next-line no-await-in-loop -- each answer is read before the next post
      expect(await json(answer)).toEqual({ accepted: true, seq });
    }
    await settle(run);
    const after = await streams.writeStats();

    const posts = after.posts - before.posts;
    const rowsPerPost = (after.rows - before.rows) / posts;
    const bytesPerPost = (after.patchBytes - before.patchBytes) / posts;
    expect(posts).toBe(50);
    // The bean's row and the one file's row (an upsert can count its replaced row too).
    expect(rowsPerPost).toBeLessThanOrEqual(4);
    expect(bytesPerPost).toBeLessThan(40);
    const patches = ofType(watching, 'bean.patch');
    expect(patches).toHaveLength(50);
    expect(
      patches.every((patch) => Array.isArray(patch['files']) && patch['files'].length === 1),
    ).toBe(true);
    const stream = await gateway.beanStream(run.run, 't001');
    expect(stream.ok && stream.value?.files).toHaveLength(100);
  });

  it('drops the snapshot when the invocation ends: its commit supersedes it', async () => {
    const { run, token, inv } = await running();
    const viewer = await openStreams(run);
    await post(run, inv, token, full(1));

    const result = await call('POST', `/v1/runs/${run.run}/invocations/${inv}/result`, {
      token,
      body: { ok: true, subtype: 'success', head_sha: '4'.repeat(40), new_commit: true },
    });
    expect(result.status).toBe(200);
    let late = await post(run, inv, token, full(2));
    for (let attempt = 0; attempt < 50 && late.status === 200; attempt += 1) {
      advance(500);
      // oxlint-disable-next-line no-await-in-loop -- the close lands in the background
      late = await post(run, inv, token, full(3 + attempt));
    }
    await settle(run);

    expect(late.status).toBe(409);
    expect(await json(late)).toMatchObject({ error: { code: 'closed_invocation' } });
    expect(await gateway.beanStream(run.run, 't001')).toEqual({ ok: true, value: null });
    expect(ofType(viewer, 'bean.streaming.end')).toEqual([
      expect.objectContaining({ task: 't001', inv }),
    ]);
  });

  it('is refused when the run does not stream diffs, and from another slot', async () => {
    const off = await running({ stream_diffs: false });
    const on = await running({ agents: 2 });

    const refused = await post(off.run, off.inv, off.token, full(1));
    const wrong = await post(on.run, on.inv, slotToken(on.run, 'a1'), full(1));
    const bad = await post(on.run, on.inv, on.token, { seq: 0, files: [] });
    const extra = await post(on.run, on.inv, on.token, { ...full(1), patches: [] });

    expect(refused.status).toBe(409);
    expect(await json(refused)).toMatchObject({ error: { code: 'stream_off' } });
    expect(wrong.status).toBe(403);
    expect(bad.status).toBe(400);
    expect(extra.status).toBe(400);
  });

  it('serves the stream socket only to a reader of the run', async () => {
    const { run } = await running();

    const anonymous = await call('GET', `/runs/${run.run}/streams`, {
      headers: { upgrade: 'websocket' },
    });
    const plain = await call('GET', `/runs/${run.run}/streams?key=${run.view.token}`);

    expect(anonymous.status).toBe(401);
    expect(plain.status).toBe(400);
  });
});
