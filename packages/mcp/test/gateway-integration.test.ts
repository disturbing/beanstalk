import { env, SELF } from 'cloudflare:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  BeanInboxPage,
  BeanThreadPostResult,
  BeanUpdateResult,
} from '@beanstalk/shared-race/collaboration';

const ORIGIN = 'https://mcp.integration.test';
const ADMIN = 'mcp-test-admin';
const clients: Client[] = [];
const CreatedRun = z.object({
  run: z.string(),
  slots: z.array(z.object({ token: z.string() })),
  view: z.object({ token: z.string() }),
});

async function adminPost(path: string, body: unknown) {
  const response = await env.GATEWAY.fetch(`https://gateway.integration.test${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (response.status !== 201)
    throw new Error(`admin route failed: ${response.status} ${await response.text()}`);
  const result: unknown = await response.json();
  return result;
}

async function createRun() {
  return CreatedRun.parse(
    await adminPost('/v1/runs', {
      policy: 'queue',
      agents: 2,
      ci_seconds: 0,
      tasks: ['t001', 't002'].map((id) => ({
        id,
        title: `Shipping ${id}`,
        prompt: `Keep compatible delivery estimates for ${id}.`,
        acceptance_tests: { [`tests/${id}.test.ts`]: `test('${id}');\n` },
        oracle_paths: [`src/${id}.ts`],
        oracle_modules: ['src'],
        kind: 'feature',
        difficulty: 1,
        couplings: [],
      })),
    }),
  );
}

async function contributor(run: string, bean: string, actor: string): Promise<Client> {
  const grant = z
    .object({ token: z.string() })
    .parse(await adminPost(`/v1/runs/${run}/contributor-token`, { bean, actor }));
  return connect(grant.token);
}

async function connect(token: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
    fetch: (input, init) => SELF.fetch(new Request(input, init)),
  });
  const client = new Client({ name: 'real-gateway-integration', version: '0.0.0' });
  await client.connect(transport);
  clients.push(client);
  return client;
}

async function call(client: Client, name: string, input: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: input });
  const content = z
    .array(z.object({ type: z.literal('text'), text: z.string() }))
    .parse(result.content);
  const text = content[0]?.text ?? 'null';
  if (result.isError === true) throw new Error(text);
  const value: unknown = JSON.parse(text);
  return value;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe('MCP through the real gateway and SQLite RunDO', () => {
  it('persists independently attributed approaches and requests through the service binding', async () => {
    const run = await createRun();
    const [a, b] = await Promise.all([
      contributor(run.run, 't001', 'harness-a'),
      contributor(run.run, 't002', 'harness-b'),
    ]);
    const approach = BeanUpdateResult.parse(
      await call(a, 'bean_update', {
        bean: 't001',
        expected_revision: 0,
        changes: {
          approach: {
            summary: 'Expose businessDays while preserving days.',
            paths: ['src/shipping.ts'],
          },
        },
        idempotency_key: 'approach-a',
      }),
    );
    expect(approach.bean).toMatchObject({ revision: 1, actor: 'harness-a' });
    const request = BeanThreadPostResult.parse(
      await call(b, 'bean_thread_post', {
        bean: 't001',
        kind: 'request',
        body: 'Could days retain calendar-day semantics?',
        references: [],
        idempotency_key: 'request-b',
      }),
    );
    expect(request.post).toMatchObject({
      author_bean: 't002',
      actor: 'harness-b',
      kind: 'request',
    });
    const inbox = BeanInboxPage.parse(await call(a, 'bean_inbox_read', { state: 'unread' }));
    expect(inbox.events).toContainEqual(
      expect.objectContaining({
        acknowledged: false,
        event: { kind: 'thread.posted', event_id: request.post.event_id, post: request.post },
      }),
    );
    const view = await connect(run.view.token);
    const context = await call(view, 'bean_context', { bean: 't001' });
    expect(context).toMatchObject({
      bean: approach.bean,
      history: expect.arrayContaining([
        expect.objectContaining({ kind: 'thread.posted', event_id: request.post.event_id }),
      ]),
    });
    expect(context).toHaveProperty('related_context.discovery.declared.status', 'available');
    expect((await view.listTools()).tools.map((tool) => tool.name)).not.toContain('bean_update');
    await expect(
      call(b, 'bean_update', {
        bean: 't001',
        expected_revision: 1,
        changes: { intent: 'Other owner edit' },
        idempotency_key: 'wrong-owner',
      }),
    ).rejects.toThrow(/own|forbidden/);
    const beforeAck = await call(a, 'bean_context', { bean: 't001' });
    expect(beforeAck).toHaveProperty('inbox.unread', 1);
    await call(a, 'bean_inbox_ack', { event_ids: [request.post.event_id] });
    expect(await call(a, 'bean_context', { bean: 't001' })).toHaveProperty('inbox.unread', 0);
    const slotToken = run.slots[0]?.token;
    if (slotToken === undefined) throw new Error('run has no first slot');
    const denied = await SELF.fetch(`${ORIGIN}/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${slotToken}` },
      body: '{}',
    });
    expect(denied.status).toBe(403);
  });
});
