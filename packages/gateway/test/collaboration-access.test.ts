import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import {
  BeanContext,
  BeanThreadPostInput,
  BeanThreadPostResult,
  BeanUpdateInput,
} from '@gitstalk/shared-race/collaboration';

import { ADMIN, call, createRun, json, slotToken } from './helpers';
import type { CreatedRun } from './helpers';

const gateway = exports.default;

type Grant = { token: string; bean: string; actor: string; expires_at: string };

async function grant(run: CreatedRun, bean: string, actor = 'independent-agent'): Promise<Grant> {
  const response = await call('POST', `/v1/runs/${run.run}/contributor-token`, {
    token: ADMIN,
    body: { bean, actor },
  });
  expect(response.status).toBe(201);
  return json<Grant>(response);
}

describe('independent contributor capabilities', () => {
  it('requires the admin to grant an existing bean and verifies a stable contributor identity', async () => {
    const run = await createRun();
    const denied = await call('POST', `/v1/runs/${run.run}/contributor-token`, {
      token: run.view.token,
      body: { bean: 't001', actor: 'checkout' },
    });
    const missing = await call('POST', `/v1/runs/${run.run}/contributor-token`, {
      token: ADMIN,
      body: { bean: 'unknown', actor: 'checkout' },
    });
    const token = await grant(run, 't001', 'checkout');

    expect(denied.status).toBe(401);
    expect(missing.status).toBe(404);
    expect(await gateway.verifyMcpToken(token.token)).toEqual({
      ok: true,
      value: {
        scope: 'contributor',
        run: run.run,
        bean: 't001',
        actor: 'checkout',
        expires_at: token.expires_at,
      },
    });
    expect(await gateway.verifyMcpToken(run.view.token)).toMatchObject({
      ok: true,
      value: { scope: 'view', run: run.run },
    });
    expect(await gateway.verifyViewToken(token.token)).toMatchObject({
      ok: false,
      error: { status: 403 },
    });
    expect(await gateway.verifyMcpToken(token.token + 'forged')).toMatchObject({
      ok: false,
      error: { status: 401 },
    });
  });

  it('keeps view, slot and seed scopes separate from contributor mutations', async () => {
    const run = await createRun();
    const input = BeanUpdateInput.parse({
      bean: 't001',
      expected_revision: 0,
      changes: {
        approach: { summary: 'Preserve calendar-day semantics.', paths: ['src/shipping.ts'] },
      },
      idempotency_key: 'approach-1',
    });
    const seedResponse = await call('POST', `/v1/runs/${run.run}/seed-token`, { token: ADMIN });
    const seed = await json<{ token: string }>(seedResponse);
    const deniedWrites = await Promise.all(
      [run.view.token, slotToken(run, 'a0'), seed.token].map((token) =>
        gateway.beanUpdate(token, input),
      ),
    );
    for (const result of deniedWrites) {
      expect(result).toMatchObject({
        ok: false,
        error: { status: 403 },
      });
    }
    const contributor = await grant(run, 't001');
    expect(
      await gateway.beanUpdate(contributor.token, {
        ...input,
        bean: BeanUpdateInput.shape.bean.parse('t002'),
      }),
    ).toMatchObject({ ok: false, error: { status: 403 } });
    const otherRun = await createRun();
    const crossRun = await call('POST', `/v1/runs/${otherRun.run}/beans/t001/collaboration`, {
      token: contributor.token,
      body: input,
    });
    expect(crossRun.status).toBe(403);
    const driver = await call('POST', `/v1/runs/${run.run}/agents/a0/next`, {
      token: contributor.token,
    });
    expect(driver.status).toBe(403);
    const git = await call(
      'GET',
      `/git/beanstalk-race/${run.repo.name}.git/info/refs?service=git-upload-pack`,
      { token: contributor.token },
    );
    expect(git.status).toBe(403);
    const untouched = await gateway.beanContext(run.run, { bean: input.bean });
    expect(untouched).toMatchObject({ ok: true, value: { bean: { revision: 0 } } });
  });

  it('supports a request and exact promise agreement through HTTP without assigning work', async () => {
    const run = await createRun();
    const shipping = await grant(run, 't001', 'shipping');
    const checkout = await grant(run, 't002', 'checkout');
    const update = BeanUpdateInput.parse({
      bean: 't001',
      expected_revision: 0,
      changes: {
        approach: {
          summary: 'Add explicit units and preserve the days alias.',
          paths: ['src/shipping.ts'],
        },
        promises: [
          {
            id: 'shipping-estimate',
            body: 'calendarDays and businessDays are explicit; days aliases calendarDays.',
            conditions: 'Compatibility alias remains available.',
            paths: ['src/shipping.ts'],
          },
        ],
      },
      idempotency_key: 'offer-1',
    });
    const offered = await call('POST', `/v1/runs/${run.run}/beans/t001/collaboration`, {
      token: shipping.token,
      body: update,
    });
    expect(offered.status).toBe(200);
    const request = BeanThreadPostInput.parse({
      bean: 't001',
      kind: 'request',
      body: 'Please preserve days for checkout.',
      references: [],
      idempotency_key: 'request-1',
    });
    const requested = await call('POST', `/v1/runs/${run.run}/beans/t001/threads`, {
      token: checkout.token,
      body: request,
    });
    expect(requested.status).toBe(201);
    const first = BeanThreadPostResult.parse(await requested.json());
    const reply = BeanThreadPostInput.parse({
      bean: 't001',
      thread: first.post.thread,
      reply_to: first.post.event_id,
      kind: 'counterproposal',
      body: 'Use explicit calendarDays; days remains compatible.',
      references: [{ bean: 't001', promise: 'shipping-estimate', revision: 1 }],
      idempotency_key: 'reply-1',
    });
    const replied = await gateway.beanThreadPost(shipping.token, reply);
    if (!replied.ok) throw new Error(replied.error.message);
    const acceptance = BeanThreadPostInput.parse({
      ...reply,
      kind: 'accept',
      body: 'Checkout accepts shipping-estimate@1.',
      reply_to: replied.value.post.event_id,
      idempotency_key: 'accept-1',
    });
    const accepted = await call('POST', `/v1/runs/${run.run}/beans/t001/threads`, {
      token: checkout.token,
      body: acceptance,
    });
    expect(accepted.status).toBe(201);
    const contextResponse = await call('GET', `/v1/runs/${run.run}/beans/t002/context`, {
      token: checkout.token,
    });
    expect(contextResponse.status).toBe(200);
    const context = BeanContext.parse(await contextResponse.json());
    expect(context.reliance).toContainEqual(
      expect.objectContaining({
        bean: 't001',
        promise: 'shipping-estimate',
        revision: 1,
        actor: 'checkout',
        accepted_event: expect.any(Number),
      }),
    );
    expect(context.referenced_promises).toContainEqual(
      expect.objectContaining({ id: 'shipping-estimate', revision: 1 }),
    );
    const read = await call('GET', `/v1/runs/${run.run}/collaboration/inbox?limit=1`, {
      token: shipping.token,
    });
    expect(read.status).toBe(200);
    const inbox = await json<{ events: { event: { event_id: number } }[]; unread: number }>(read);
    const event = inbox.events[0]?.event.event_id;
    if (event === undefined) throw new Error('missing request notification');
    const ack = await call('POST', `/v1/runs/${run.run}/collaboration/inbox/ack`, {
      token: shipping.token,
      body: { event_ids: [event] },
    });
    expect(ack.status).toBe(200);
    const state = await gateway.runView(run.run);
    expect(state).toMatchObject({
      ok: true,
      value: { phase: 'created', task_status: { t001: 'pending', t002: 'pending' } },
    });
  });
  it('refuses an unauthenticated mutation before parsing its body', async () => {
    const run = await createRun();
    const contributor = await grant(run, 't001');
    const paths = [
      `/v1/runs/${run.run}/beans/t001/collaboration`,
      `/v1/runs/${run.run}/beans/t001/threads`,
      `/v1/runs/${run.run}/collaboration/inbox/ack`,
    ];
    for (const path of paths) {
      const anonymous = await call('POST', path, { body: { nonsense: true } });
      const foreign = await call('POST', path, { token: run.view.token, body: { nonsense: true } });
      const authorised = await call('POST', path, {
        token: contributor.token,
        body: { nonsense: true },
      });
      expect([anonymous.status, foreign.status, authorised.status]).toEqual([401, 403, 400]);
    }
    const inbox = await call('GET', `/v1/runs/${run.run}/collaboration/inbox?limit=0`);
    expect(inbox.status).toBe(401);
  });
});
