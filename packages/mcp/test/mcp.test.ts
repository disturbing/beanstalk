import { createExecutionContext, env, SELF } from 'cloudflare:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createApp } from '../src/app';
import { createLogger } from '../src/log';
import { TOOL_NAMES } from '../src/mcp/server';
import { fakeGateway, RUN, SLOT_TOKEN, VIEW_TOKEN, WINDOW_SIZE } from './fake-gateway';

const ORIGIN = 'https://gitstalk-mcp.example.workers.dev';
const WEB_URL = 'https://gitstalk-web.example.workers.dev';

const app = createApp(() => ({ gateway: fakeGateway(), log: createLogger('error') }));
const clients: Client[] = [];

function post(
  token: string | null,
  body: unknown = { jsonrpc: '2.0', id: 1, method: 'tools/list' },
) {
  const headers = new Headers({
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  });
  if (token !== null) headers.set('authorization', `Bearer ${token}`);
  return send(
    new Request(`${ORIGIN}/mcp`, { method: 'POST', headers, body: JSON.stringify(body) }),
  );
}

/** Into the app as the platform would deliver it: with a Host header. */
async function send(request: Request): Promise<Response> {
  const delivered = new Request(request);
  delivered.headers.set('host', new URL(request.url).host);
  return app.fetch(delivered, env, createExecutionContext());
}

async function connect(): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${VIEW_TOKEN}` } },
    fetch: (input, init) => send(new Request(input, init)),
  });
  const client = new Client({ name: 'gitstalk-test', version: '0.0.0' });
  await client.connect(transport);
  clients.push(client);
  return client;
}

/** Calls a tool and parses its JSON answer. */
async function call(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const client = await connect();
  const result = await client.callTool({ name, arguments: args });
  const content = z
    .array(z.object({ type: z.literal('text'), text: z.string() }))
    .parse(result.content);
  if (result.isError === true) throw new Error(content[0]?.text);
  return JSON.parse(content[0]?.text ?? 'null');
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe('auth', () => {
  it('answers 401 without a token, through the deployed entrypoint', async () => {
    const response = await SELF.fetch(`${ORIGIN}/mcp`, { method: 'POST', body: '{}' });
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toMatch(/^Bearer /);
  });

  it('answers 401 for a token the gateway does not recognise, and 403 for a slot token', async () => {
    expect((await post('bst1.forged')).status).toBe(401);
    expect((await post(SLOT_TOKEN)).status).toBe(403);
  });
});

describe('tools/list', () => {
  it('lists the six read-only tools and no execute tool', async () => {
    const { tools } = await (await connect()).listTools();

    expect(tools.map((tool) => tool.name).toSorted()).toEqual([...TOOL_NAMES].toSorted());
    expect(tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
    expect(tools.every((tool) => tool.annotations?.destructiveHint === false)).toBe(true);
  });
});

describe('tools/call', () => {
  it('ask_repo answers with the Ask view as JSON', async () => {
    const answer = await call('ask_repo', { question: 'show bean t021' });

    expect(answer).toMatchObject({
      question: 'show bean t021',
      spec: { class: 'bean', entities: { bean: 't021' } },
      main: { kind: 'bean', handle: 'bean:t021' },
      ref: { name: 'sprout' },
    });
    expect(answer).toHaveProperty('preview_url', `${WEB_URL}/runs/${RUN}?q=show+bean+t021`);
    expect(
      z
        .object({
          files: z.array(z.unknown()),
          beans: z.array(z.unknown()),
          decisions: z.array(z.unknown()),
        })
        .safeParse(answer).success,
    ).toBe(true);
  });

  it('work_overlaps lists recently landed beans on a path, with their intents', async () => {
    const answer = z
      .object({
        beans: z.array(
          z.object({
            bean: z.string(),
            title: z.string(),
            intent: z.string(),
            slot: z.string().nullable(),
            status: z.string(),
            files: z.array(z.string()),
            overlap: z.array(z.string()),
          }),
        ),
        summary: z.string(),
      })
      .parse(await call('work_overlaps', { paths: ['src/notifications'] }));

    expect(answer.beans.every((bean) => bean.overlap.includes('src/notifications'))).toBe(true);
    expect(answer.summary).toMatch(/bean|No bean/);
  });

  it('change_status reports a bean, by id or branch', async () => {
    const answer = await call('change_status', { bean: 'beans/t005' });

    expect(answer).toMatchObject({
      bean: 't005',
      branch: 'beans/t005',
      status: 'green',
      next: 'On the stalk. Done.',
      preview_url: `${WEB_URL}/runs/${RUN}?bean=t005`,
    });
  });

  it('checks_get gives structured failures and flags protected tests', async () => {
    const answer = z
      .object({
        checks: z.object({ total: z.number(), red: z.number(), inherited: z.number() }),
        history: z.array(z.object({ green: z.boolean() })),
        failures: z.array(
          z.object({
            file: z.string(),
            test: z.string(),
            inherited: z.boolean(),
            protected: z.boolean(),
          }),
        ),
        summary: z.string(),
      })
      .parse(await call('checks_get', { bean: 't010' }));

    expect(answer.checks.red).toBeGreaterThan(0);
    expect(answer.history.length).toBeGreaterThan(0);
    expect(answer.summary).toContain('t010');
  });

  it('run_status gives the lines, the window, work in flight and cost', async () => {
    const answer = await call('run_status');

    expect(answer).toMatchObject({
      run: RUN,
      policy: 'beanstalk',
      phase: 'ended',
      window: { size: WINDOW_SIZE },
      red_validations: { count: expect.any(Number) },
      cost_usd: expect.any(Number),
    });
    expect(answer).toHaveProperty('sprout.sha', expect.stringMatching(/^[0-9a-f]{40}$/));
  });

  it('preview_link links a bean or a line, never both', async () => {
    expect(await call('preview_link', { ref: 'stalk' })).toMatchObject({
      url: `${WEB_URL}/runs/${RUN}?ref=stalk`,
    });
    await expect(call('preview_link', { bean: 't005', ref: 'stalk' })).rejects.toThrow(/not both/);
  });

  it('reports an unknown bean as a tool error', async () => {
    await expect(call('change_status', { bean: 't999' })).rejects.toThrow(/no bean t999/);
  });
});
