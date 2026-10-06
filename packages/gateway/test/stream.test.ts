import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import type { CreatedRun, Next } from './helpers';
import { ADMIN, call, createRun, json, pushBase, slotToken } from './helpers';

const BASE = '3'.repeat(40);
const gateway = exports.default;

const PATCH = '@@ -0,0 +1,2 @@\n+export const total = 1;\n+export const tax = 2;\n';

function snapshot(seq: number, extra: Record<string, unknown> = {}) {
  return {
    seq,
    files: [
      { path: 'src/t001.ts', status: 'added', additions: 2, deletions: 0, patch: PATCH },
      { path: 'logo.png', status: 'added', additions: 0, deletions: 0, binary: true },
    ],
    trigger: 'Write',
    ...extra,
  };
}

/** A started run and slot a0's first invocation. */
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
  return { run, token, inv };
}

function post(run: CreatedRun, inv: string, token: string, body: unknown) {
  return call('POST', `/v1/runs/${run.run}/invocations/${inv}/stream`, { token, body });
}

/** The live feed's messages, as the web app's bridge receives them. */
async function openFeed(run: CreatedRun): Promise<unknown[]> {
  const response = await call('GET', `/v1/runs/${run.run}/live?key=${run.view.token}`, {
    headers: { upgrade: 'websocket' },
  });
  const socket = response.webSocket;
  if (socket === null) throw new Error(`no socket (${response.status})`);
  socket.accept();
  const messages: unknown[] = [];
  socket.addEventListener('message', (event) => {
    if (typeof event.data === 'string') messages.push(JSON.parse(event.data));
  });
  return messages;
}

/** Lets the feed's socket deliver what the object sent (a round trip through the object). */
async function settle(run: CreatedRun): Promise<void> {
  await gateway.beanStreams(run.run);
}

describe('streaming diffs', () => {
  it('keeps the latest snapshot per bean, serves it by RPC and broadcasts a summary', async () => {
    const { run, token, inv } = await running();
    const feed = await openFeed(run);

    const first = await post(run, inv, token, snapshot(1));
    await settle(run);

    expect(first.status).toBe(200);
    expect(await json(first)).toEqual({ accepted: true, seq: 1 });
    const stream = await gateway.beanStream(run.run, 't001');
    expect(stream).toMatchObject({
      ok: true,
      value: {
        summary: { type: 'bean.streaming', task: 't001', inv, agent: 'a0', seq: 1, additions: 2 },
      },
    });
    const streams = await gateway.beanStreams(run.run);
    expect(streams.ok && streams.value.map((s) => s.task)).toEqual(['t001']);
    expect(feed).toContainEqual({
      type: 'stream',
      stream: expect.objectContaining({ type: 'bean.streaming', task: 't001', seq: 1 }),
    });
  });

  it('ignores a repeated or older seq, and limits each invocation to one snapshot a second', async () => {
    const { run, token, inv } = await running();

    await post(run, inv, token, snapshot(2));
    const again = await json(await post(run, inv, token, snapshot(2)));
    const older = await json(await post(run, inv, token, snapshot(1)));
    const soon = await json(await post(run, inv, token, snapshot(3)));

    expect(again).toEqual({ accepted: false, reason: 'stale', seq: 2 });
    expect(older).toEqual({ accepted: false, reason: 'stale', seq: 2 });
    expect(soon).toEqual({ accepted: false, reason: 'rate', seq: 2 });
  });

  it('redacts lines that look like secrets before anyone can read them', async () => {
    const { run, token, inv } = await running();
    const leaky = `@@ -0,0 +1,2 @@\n+const key = "sk-ant-api03-abcdefghijkl";\n+const ok = 1;\n`;

    await post(run, inv, token, {
      seq: 1,
      files: [{ path: 'src/t001.ts', status: 'added', additions: 2, deletions: 0, patch: leaky }],
    });

    const stream = await gateway.beanStream(run.run, 't001');
    const text = JSON.stringify(stream);
    expect(text).not.toContain('sk-ant-');
    expect(text).toContain('const ok = 1');
    expect(stream.ok && stream.value?.summary.redacted).toBe(1);
  });

  it('drops the snapshot when the invocation ends: its commit supersedes it', async () => {
    const { run, token, inv } = await running();
    const feed = await openFeed(run);
    await post(run, inv, token, snapshot(1));

    const result = await call('POST', `/v1/runs/${run.run}/invocations/${inv}/result`, {
      token,
      body: { ok: true, subtype: 'success', head_sha: '4'.repeat(40), new_commit: true },
    });
    await settle(run);

    expect(result.status).toBe(200);
    expect(await gateway.beanStream(run.run, 't001')).toEqual({ ok: true, value: null });
    expect(feed).toContainEqual({
      type: 'stream',
      stream: expect.objectContaining({ type: 'bean.streaming.end', task: 't001', inv }),
    });
    const late = await post(run, inv, token, snapshot(2));
    expect(late.status).toBe(409);
  });

  it('is refused when the run does not stream diffs, and from another slot', async () => {
    const off = await running({ stream_diffs: false });
    const on = await running({ agents: 2 });

    const refused = await post(off.run, off.inv, off.token, snapshot(1));
    const wrong = await post(on.run, on.inv, slotToken(on.run, 'a1'), snapshot(1));
    const bad = await post(on.run, on.inv, on.token, { seq: 0, files: [] });

    expect(refused.status).toBe(409);
    expect(await json(refused)).toMatchObject({ error: { code: 'stream_off' } });
    expect(wrong.status).toBe(403);
    expect(bad.status).toBe(400);
  });
});
