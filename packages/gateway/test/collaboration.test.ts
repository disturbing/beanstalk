import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import {
  ContributorTokenClaims,
  BeanContextInput,
  BeanDiscoverInput,
  EXCERPT_CHARS,
  BeanThreadPostInput,
  BeanUpdateInput,
} from '@beanstalk/shared-race/collaboration';
import type { RpcResult } from '@beanstalk/shared-race/rpc';

import { readBeanContext } from '../src/collaboration/read';
import { seedCollaboration } from '../src/collaboration/store';
import { RunDO } from '../src/run/run-do';
import { createRun } from './helpers';

function value<T>(result: RpcResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

async function contributors() {
  const run = await createRun();
  const claims = (bean: string, actor: string) =>
    ContributorTokenClaims.parse({
      scope: 'contributor',
      run: run.run,
      bean,
      actor,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
  return {
    run,
    stub: env.RUNS.getByName(run.run),
    a: claims('t001', 'harness-a'),
    b: claims('t002', 'harness-b'),
  };
}

function promiseUpdate(
  expected_revision: number,
  key: string,
  body = 'Keep calendar days and add business days',
) {
  return BeanUpdateInput.parse({
    bean: 't001',
    expected_revision,
    changes: {
      promises: [
        {
          id: 'delivery',
          body,
          conditions: 'Implementation checks pending',
          paths: ['src/shipping.ts'],
        },
      ],
    },
    idempotency_key: key,
  });
}

async function agree() {
  const setup = await contributors();
  const { stub, a, b } = setup;
  const request = value(
    await stub.beanThreadPost(
      b,
      BeanThreadPostInput.parse({
        bean: 't001',
        kind: 'request',
        body: 'Can you preserve calendar days?',
        references: [],
        idempotency_key: 'request-1',
      }),
    ),
  );
  value(await stub.beanUpdate(a, promiseUpdate(0, 'offer-1')));
  const counter = value(
    await stub.beanThreadPost(
      a,
      BeanThreadPostInput.parse({
        bean: 't001',
        thread: request.post.thread,
        reply_to: request.post.event_id,
        kind: 'counterproposal',
        body: 'Keep calendarDays and add businessDays.',
        references: [{ bean: 't001', promise: 'delivery', revision: 1 }],
        idempotency_key: 'counter-1',
      }),
    ),
  );
  const acceptance = BeanThreadPostInput.parse({
    bean: 't001',
    thread: request.post.thread,
    reply_to: counter.post.event_id,
    kind: 'accept',
    body: 'Shipment emails will rely on revision 1.',
    references: counter.post.references,
    idempotency_key: 'accept-1',
  });
  const accepted = value(await stub.beanThreadPost(b, acceptance));
  return { ...setup, request, counter, acceptance, accepted };
}

describe('durable bean collaboration', () => {
  it('persists a two-bean conversation and exact accepted promise without scheduling work', async () => {
    const { stub, a, b, accepted, counter, run } = await agree();
    const context = value(await stub.beanContext({ bean: b.bean }));
    expect(context.bean.revision).toBe(1);
    expect(context.history).toContainEqual(
      expect.objectContaining({ kind: 'thread.posted', event_id: counter.post.event_id }),
    );
    const pending = value(await stub.beanInboxRead(b, {}));
    value(
      await stub.beanInboxAck(b, {
        event_ids: pending.events.map((entry) => entry.event.event_id),
      }),
    );
    expect(value(await stub.beanContext({ bean: b.bean })).history).toEqual(context.history);
    expect(context.reliance).toMatchObject([
      {
        bean: a.bean,
        promise: 'delivery',
        revision: 1,
        accepted_event: accepted.post.event_id,
        actor: b.actor,
      },
    ]);
    expect(context.referenced_promises).toMatchObject([
      { body: 'Keep calendar days and add business days', revision: 1 },
    ]);
    const persisted = await runInDurableObject(stub, (_, state) =>
      readBeanContext(state.storage.sql, { bean: b.bean }),
    );
    expect(persisted).toEqual({ ok: true, value: context });
    const reloaded = await runInDurableObject(stub, (_, state) =>
      new RunDO(state, env).beanContext({ bean: b.bean }),
    );
    expect(reloaded).toEqual(persisted);
    const view = await stub.view();
    expect(view).toMatchObject({
      ok: true,
      value: { phase: 'created', tasks: { pending: 2 }, slots: expect.any(Array) },
    });
    expect(run.slots.map((slot) => slot.slot)).toEqual(['a0', 'a1']);
  });

  it('replays retries exactly and rejects a conflicting idempotency key', async () => {
    const { stub, a, b, acceptance, accepted } = await agree();
    expect(value(await stub.beanThreadPost(b, acceptance))).toEqual(accepted);
    expect(
      await stub.beanThreadPost(b, { ...acceptance, body: 'Different acceptance' }),
    ).toMatchObject({ ok: false, error: { code: 'conflict' } });
    const update = promiseUpdate(1, 'offer-2');
    const first = value(await stub.beanUpdate(a, update));
    expect(value(await stub.beanUpdate(a, update))).toEqual(first);
    expect(await stub.beanUpdate(a, { ...update, changes: { intent: 'Different' } })).toMatchObject(
      { ok: false, error: { code: 'conflict' } },
    );
    expect(value(await stub.beanContext({ bean: a.bean })).promises[0]?.revision).toBe(2);
  });

  it('rejects stale bean edits, other-owner edits, expired grants and nonexistent identities', async () => {
    const { stub, a, b } = await contributors();
    value(await stub.beanUpdate(a, promiseUpdate(0, 'offer-1')));
    expect(await stub.beanUpdate(a, promiseUpdate(0, 'stale'))).toMatchObject({
      ok: false,
      error: { code: 'conflict' },
    });
    expect(await stub.beanUpdate(b, promiseUpdate(1, 'wrong-owner'))).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(
      await stub.beanInboxRead({ ...a, expires_at: '2000-01-01T00:00:00Z' }, {}),
    ).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await stub.beanContext(BeanContextInput.parse({ bean: 'missing' }))).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
    expect(value(await stub.beanContext({ bean: a.bean })).bean.revision).toBe(1);
  });

  it('notifies promise consumers while keeping their accepted old revision visible after a cursor', async () => {
    const { stub, a, b, accepted } = await agree();
    const before = value(await stub.beanInboxRead(b, {}));
    value(await stub.beanUpdate(a, promiseUpdate(1, 'offer-2', 'New promise wording')));
    const notices = value(
      await stub.beanInboxRead(
        { ...b, actor: ContributorTokenClaims.shape.actor.parse('replacement-harness') },
        { after_cursor: before.next_cursor },
      ),
    );
    expect(notices.events).toHaveLength(1);
    expect(notices.events[0]?.event).toMatchObject({ kind: 'bean.updated', bean: a.bean });
    const current = value(await stub.beanContext({ bean: b.bean, since: notices.current_cursor }));
    expect(current.history).toEqual([]);
    expect(current.reliance).toMatchObject([
      { revision: 1, accepted_event: accepted.post.event_id },
    ]);
    expect(current.referenced_promises).toMatchObject([
      { revision: 1, body: 'Keep calendar days and add business days' },
    ]);
  });

  it('rejects accepting a revised offer and requires a reply to the actual offering bean', async () => {
    const { stub, a, b, acceptance, request } = await agree();
    value(await stub.beanUpdate(a, promiseUpdate(1, 'offer-2')));
    expect(
      await stub.beanThreadPost(b, { ...acceptance, idempotency_key: 'stale-accept' }),
    ).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(
      await stub.beanThreadPost(a, {
        ...acceptance,
        reply_to: request.post.event_id,
        references: [{ bean: a.bean, promise: 'delivery', revision: 2 }],
        idempotency_key: 'fake-agreement',
      }),
    ).toMatchObject({ ok: false, error: { code: 'invalid_request' } });
    expect(value(await stub.beanContext({ bean: b.bean })).bean.revision).toBe(1);
  });

  it('paginates the addressed inbox and records acknowledgement separately from acceptance', async () => {
    const { stub, a, b } = await contributors();
    await Promise.all(
      Array.from({ length: 3 }, (_, index) =>
        stub.beanThreadPost(
          b,
          BeanThreadPostInput.parse({
            bean: a.bean,
            kind: 'note',
            body: `Question ${index}`,
            references: [],
            idempotency_key: `note-${index}`,
          }),
        ),
      ),
    );
    const first = value(await stub.beanInboxRead(a, { limit: 2 }));
    expect(first.truncated).toBe(true);
    expect(first.events).toHaveLength(2);
    expect(first.unread).toBe(3);
    const last = value(await stub.beanInboxRead(a, { after_cursor: first.next_cursor, limit: 2 }));
    expect(last.truncated).toBe(false);
    expect(last.events).toHaveLength(1);
    expect(last.next_cursor).toBe(last.current_cursor);
    const event_ids = first.events.map((entry) => entry.event.event_id);
    expect(value(await stub.beanInboxAck(a, { event_ids }))).toEqual({
      acknowledged: event_ids,
      unread: 1,
    });
    expect(value(await stub.beanInboxAck(a, { event_ids })).unread).toBe(1);
    expect(await stub.beanInboxAck(b, { event_ids })).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
    expect(value(await stub.beanContext({ bean: a.bean })).reliance).toEqual([]);
    const own = value(await stub.beanInboxRead(b, {}));
    expect(own.events).toEqual([]);
    expect(own.next_cursor).toBe(last.current_cursor);
  });

  it('discovers pending approaches before any diff and refreshes exact ancestor and descendant path indexes', async () => {
    const { stub, a, b } = await contributors();
    await stub.beanUpdate(
      a,
      BeanUpdateInput.parse({
        bean: a.bean,
        expected_revision: 0,
        changes: {
          approach: {
            summary: 'Support business-day shipping estimates',
            paths: ['src/shipping.ts'],
          },
        },
        idempotency_key: 'approach-a',
      }),
    );
    await stub.beanUpdate(
      b,
      BeanUpdateInput.parse({
        bean: b.bean,
        expected_revision: 0,
        changes: {
          approach: { summary: 'Preserve existing shipment email fields', paths: ['src'] },
        },
        idempotency_key: 'approach-b',
      }),
    );
    const matches = value(
      await stub.beanDiscover(BeanDiscoverInput.parse({ bean: a.bean, query: 'zzzzunmatched' })),
    );
    expect(matches.beans).toMatchObject([
      {
        bean: b.bean,
        revision: 1,
        paths: ['src'],
        intent_truncated: false,
      },
    ]);
    expect(matches.records).toBeUndefined();
    expect(matches.truncated).toBe(false);
    const reverse = value(
      await stub.beanDiscover(BeanDiscoverInput.parse({ bean: b.bean, query: 'zzzzunmatched' })),
    );
    expect(reverse.beans.map((bean) => bean.bean)).toEqual([a.bean]);
    expect(await stub.bean(a.bean)).toMatchObject({
      ok: true,
      value: { files: [], head_sha: null },
    });
    await stub.beanUpdate(
      b,
      BeanUpdateInput.parse({
        bean: b.bean,
        expected_revision: 1,
        changes: { approach: { summary: 'Catalog thumbnails', paths: ['images'] } },
        idempotency_key: 'approach-b2',
      }),
    );
    expect(
      value(
        await stub.beanDiscover(BeanDiscoverInput.parse({ bean: a.bean, query: 'zzzzunmatched' })),
      ).beans,
    ).toEqual([]);
    expect(
      value(
        await stub.beanDiscover(
          BeanDiscoverInput.parse({ bean: a.bean, paths: [], query: 'thumbnails' }),
        ),
      ).beans,
    ).toMatchObject([{ bean: b.bean, revision: 2 }]);
  });

  it('ends a reliance explicitly without erasing its agreement or receiving later promise notices', async () => {
    const { stub, a, b, accepted } = await agree();
    const before = value(await stub.beanInboxRead(b, {}));
    value(
      await stub.beanUpdate(
        b,
        BeanUpdateInput.parse({
          bean: b.bean,
          expected_revision: 1,
          changes: { remove_reliance: [{ bean: a.bean, promise: 'delivery' }] },
          idempotency_key: 'stop-relying',
        }),
      ),
    );
    value(await stub.beanUpdate(a, promiseUpdate(1, 'offer-2')));
    const current = value(await stub.beanContext({ bean: b.bean }));
    expect(current.reliance).toEqual([]);
    expect(current.referenced_promises).toEqual([]);
    expect(current.history).toContainEqual(
      expect.objectContaining({ kind: 'thread.posted', event_id: accepted.post.event_id }),
    );
    expect(value(await stub.beanInboxRead(b, { after_cursor: before.next_cursor })).events).toEqual(
      [],
    );
  });

  it('finds later unread messages when the oldest five have already been acknowledged', async () => {
    const { stub, a, b } = await contributors();
    await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        stub.beanThreadPost(
          b,
          BeanThreadPostInput.parse({
            bean: a.bean,
            kind: 'note',
            body: `Question ${index}`,
            references: [],
            idempotency_key: `unread-${index}`,
          }),
        ),
      ),
    );
    const all = value(await stub.beanInboxRead(a, {}));
    value(
      await stub.beanInboxAck(a, {
        event_ids: all.events.slice(0, 5).map((entry) => entry.event.event_id),
      }),
    );
    const unread = value(await stub.beanInboxRead(a, { state: 'unread', limit: 5 }));
    expect(unread.events).toHaveLength(1);
    expect(unread.events[0]?.event).toMatchObject({
      kind: 'thread.posted',
      post: { body: 'Question 5' },
    });
    expect(unread.unread).toBe(1);
    expect(unread.truncated).toBe(false);
  });

  it('rolls back the post, event and idempotency key if inbox persistence fails', async () => {
    const { stub, a, b } = await contributors();
    const input = BeanThreadPostInput.parse({
      bean: a.bean,
      kind: 'request',
      body: 'Preserve compatibility',
      references: [],
      idempotency_key: 'atomic-request',
    });
    await runInDurableObject(stub, (_, state) => {
      state.storage.sql.exec(
        "CREATE TRIGGER fail_collaboration_inbox BEFORE INSERT ON collaboration_inbox BEGIN SELECT RAISE(ABORT, 'inbox unavailable'); END",
      );
    });
    const error = await runInDurableObject(stub, (instance) => {
      try {
        instance.beanThreadPost(b, input);
        return null;
      } catch (failure: unknown) {
        return failure instanceof Error ? failure.message : String(failure);
      }
    });
    expect(error).toContain('inbox unavailable');
    await runInDurableObject(stub, (_, state) => {
      state.storage.sql.exec('DROP TRIGGER fail_collaboration_inbox');
    });
    const before = value(await stub.beanContext({ bean: a.bean }));
    expect(before.current_cursor).toBe(0);
    const retried = value(await stub.beanThreadPost(b, input));
    expect(retried.post.event_id).toBe(1);
    expect(value(await stub.beanInboxRead(a, {})).events).toHaveLength(1);
  });
  it('discovers lightweight digests by default and full records only on request', async () => {
    const { stub, a, b } = await contributors();
    const intent = `shipping ${'long '.repeat(1900)}`.trim();
    value(
      await stub.beanUpdate(
        b,
        BeanUpdateInput.parse({
          bean: b.bean,
          expected_revision: 0,
          changes: { intent, approach: { summary: 'Shipping estimates', paths: ['src/ship.ts'] } },
          idempotency_key: 'long-intent',
        }),
      ),
    );
    const input = { bean: a.bean, query: 'shipping' };
    const digest = value(await stub.beanDiscover(BeanDiscoverInput.parse(input)));
    expect(digest.beans).toEqual([
      {
        bean: b.bean,
        revision: 1,
        updated_at: expect.any(String),
        intent: intent.slice(0, EXCERPT_CHARS),
        intent_truncated: true,
        paths: ['src/ship.ts'],
      },
    ]);
    expect(digest.records).toBeUndefined();
    const full = value(await stub.beanDiscover(BeanDiscoverInput.parse({ ...input, full: true })));
    expect(full.records).toMatchObject([{ bean: b.bean, intent }]);
    expect(full.beans).toEqual(digest.beans);
  });

  it('summarises peers in excerpts with promises and reliance but no history', async () => {
    const { stub, a, b } = await agree();
    value(
      await stub.beanUpdate(
        a,
        BeanUpdateInput.parse({
          bean: a.bean,
          expected_revision: 1,
          changes: { approach: { summary: 'x'.repeat(900), paths: ['src/shipping.ts'] } },
          idempotency_key: 'long-approach',
        }),
      ),
    );
    const summaries = value(await stub.beanPeerSummaries(['t002', 't001', 'unknown', 't001']));
    expect(summaries.map((summary) => summary.bean)).toEqual(['t001', 't002']);
    const [first, second] = summaries;
    expect(first).toMatchObject({
      bean: 't001',
      revision: 2,
      approach_summary: 'x'.repeat(EXCERPT_CHARS),
      approach_summary_truncated: true,
      paths: ['src/shipping.ts'],
      promises: [{ id: 'delivery', revision: 1, paths: ['src/shipping.ts'] }],
      reliance: [],
    });
    expect(second).toMatchObject({
      bean: b.bean,
      approach_summary: null,
      reliance: [{ bean: 't001', promise: 'delivery', revision: 1 }],
    });
    expect(first).not.toHaveProperty('history');
    expect(await stub.beanPeerSummaries([])).toMatchObject({ ok: false });
  });

  it('seeds only beans it has not stored and leaves collaboration state alone', async () => {
    const { stub, a } = await contributors();
    value(await stub.beanUpdate(a, promiseUpdate(0, 'offer-seed')));
    const seeded = await runInDurableObject(stub, (_, state) => {
      seedCollaboration(state.storage.sql, [
        { id: 't001', prompt: 'a different prompt' },
        { id: 'z900', prompt: 'brand new bean' },
      ]);
      return state.storage.sql
        .exec<{ bean: string }>(
          'SELECT bean FROM collaboration_beans WHERE bean IN (?, ?)',
          't001',
          'z900',
        )
        .toArray()
        .map((row) => row.bean)
        .toSorted();
    });
    expect(seeded).toEqual(['t001', 'z900']);
    const context = value(await stub.beanContext({ bean: a.bean }));
    expect(context.bean.revision).toBe(1);
    expect(context.bean.intent).not.toBe('a different prompt');
    expect(
      value(await stub.beanContext({ bean: BeanContextInput.shape.bean.parse('z900') })).bean
        .intent,
    ).toBe('brand new bean');
  });

  it('replays an in-flight request resent by a replacement harness under another actor', async () => {
    const { stub, a, b } = await contributors();
    const replacement = ContributorTokenClaims.parse({ ...a, actor: 'replacement-harness' });
    const input = BeanThreadPostInput.parse({
      bean: b.bean,
      kind: 'note',
      body: 'Heads up about shipping',
      references: [],
      idempotency_key: 'resend-1',
    });
    const first = value(await stub.beanThreadPost(a, input));
    const resent = value(await stub.beanThreadPost(replacement, input));
    expect(resent).toEqual(first);
    expect(value(await stub.beanContext({ bean: b.bean })).current_cursor).toBe(1);
  });
});
