import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import type { AgentAssignment } from '../src/agent/assignment';
import { gatewayRoute, serveControl, serveGateway, serveModel } from '../src/agent/virtual-hosts';
import type { HostDeps, MatchPort } from '../src/agent/virtual-hosts';
import type { SeatGrant } from '../src/broker/broker-do';
import type { Credential } from '../src/match/match-schema';
import type { ModelAccess } from '../src/match/match-do';

type Recorded = { requests: Request[]; spend: [string, number][]; tokens: string[] };

function harness(options: {
  gateway?: (request: Request) => Response;
  upstream?: (request: Request) => Response;
  access?: ModelAccess;
  grant?: SeatGrant;
}): { deps: HostDeps; recorded: Recorded } {
  const recorded: Recorded = { requests: [], spend: [], tokens: [] };
  let assignment: AgentAssignment = {
    match: 'm-test',
    slot: 'a1',
    run: 'run-1',
    token: 'real-slot-token-0001',
  };
  const credential: Credential = { mode: 'none' };
  const match: MatchPort = {
    hello: async () => {},
    slotConfig: async () => ({ released: false, halted: false, reason: null }),
    appendLog: async () => true,
    putFile: async () => {},
    slotExited: async () => {},
    recordSpend: async (inv, usd) => {
      recorded.spend.push([inv, usd]);
    },
    modelAccess: async () => options.access ?? { ok: true, credential, holder: 'm-test:a1' },
    reissueTokens: async () => false,
  };
  const deps: HostDeps = {
    env,
    agent: {
      assignment: async () => assignment,
      setToken: async (token) => {
        recorded.tokens.push(token);
        assignment = { ...assignment, token };
      },
      touch: async () => {},
    },
    matchOf: () => match,
    broker: {
      lease: async () =>
        options.grant ?? { ok: true, accessToken: 'seat-access-token', accountId: 'acct-1' },
    },
    gateway: {
      fetch: async (request) => {
        recorded.requests.push(request);
        return options.gateway?.(request) ?? Response.json({});
      },
    },
    upstream: async (request) => {
      recorded.requests.push(request);
      return options.upstream?.(request) ?? new Response('data: {}\n\n');
    },
  };
  return { deps, recorded };
}

describe('gatewayRoute', () => {
  it('allows only this slot, this run and git', () => {
    expect(gatewayRoute('POST', '/v1/runs/run-1/agents/a1/next', 'run-1', 'a1')).toEqual({
      kind: 'next',
    });
    expect(gatewayRoute('POST', '/v1/runs/run-1/agents/a2/next', 'run-1', 'a1')).toBeNull();
    expect(gatewayRoute('POST', '/v1/runs/run-2/invocations/i1/result', 'run-1', 'a1')).toBeNull();
    expect(gatewayRoute('POST', '/v1/runs/run-1/invocations/i1/result', 'run-1', 'a1')).toEqual({
      kind: 'invocation',
      invocation: 'i1',
      action: 'result',
    });
    expect(gatewayRoute('POST', '/v1/runs/run-1/start', 'run-1', 'a1')).toBeNull();
    expect(gatewayRoute('GET', '/git/ns/repo.git/info/refs', 'run-1', 'a1')).toEqual({
      kind: 'git',
    });
    expect(gatewayRoute('DELETE', '/git/ns/repo.git', 'run-1', 'a1')).toBeNull();
  });
});

describe('bs.internal', () => {
  it('adds the slot token and takes the refreshed one out of next', async () => {
    const { deps, recorded } = harness({
      gateway: () =>
        Response.json({
          invocation: { inv: 'i1' },
          token: { token: 'refreshed-slot-token-0002', expires_at: 1 },
        }),
    });
    const response = await serveGateway(
      new Request('http://bs.internal/v1/runs/run-1/agents/a1/next', {
        method: 'POST',
        headers: { authorization: 'Bearer swarm-slot-placeholder' },
      }),
      deps,
    );
    const body = await response.text();
    expect(body).not.toContain('refreshed-slot-token');
    expect(JSON.parse(body)).toEqual({ invocation: { inv: 'i1' } });
    expect(recorded.tokens).toEqual(['refreshed-slot-token-0002']);
    expect(recorded.requests[0]?.headers.get('authorization')).toBe('Bearer real-slot-token-0001');
  });

  it('records the cost of a result and refuses other routes', async () => {
    const { deps, recorded } = harness({});
    await serveGateway(
      new Request('http://bs.internal/v1/runs/run-1/invocations/i9/result', {
        method: 'POST',
        body: JSON.stringify({ cost_usd: 0.25, ok: true }),
      }),
      deps,
    );
    expect(recorded.spend).toEqual([['i9', 0.25]]);
    const refused = await serveGateway(
      new Request('http://bs.internal/v1/runs/run-1/stop', { method: 'POST' }),
      deps,
    );
    expect(refused.status).toBe(403);
    expect(recorded.requests).toHaveLength(1);
  });
});

describe('model.internal', () => {
  it('adds the API key outside the container and maps /v1 onto the upstream', async () => {
    const { deps, recorded } = harness({
      access: { ok: true, credential: { mode: 'api-key' }, holder: 'm-test:a1' },
    });
    const response = await serveModel(
      new Request('http://model.internal/v1/responses', {
        method: 'POST',
        headers: { authorization: 'Bearer swarm-placeholder-not-a-key' },
        body: '{}',
      }),
      deps,
    );
    expect(response.status).toBe(200);
    const sent = recorded.requests[0];
    expect(sent?.url).toBe('https://api.openai.com/v1/responses');
    expect(sent?.headers.get('authorization')).toBe('Bearer sk-test-not-a-real-key-0123456789');
  });

  it('adds the leased seat token and account for the ChatGPT backend', async () => {
    const { deps, recorded } = harness({
      access: { ok: true, credential: { mode: 'lease', seat: 'default' }, holder: 'm-test:a1' },
    });
    await serveModel(
      new Request('http://model.internal/backend-api/codex/responses', {
        method: 'POST',
        headers: { authorization: 'Bearer placeholder', 'chatgpt-account-id': 'swarm-placeholder' },
        body: '{}',
      }),
      deps,
    );
    const sent = recorded.requests[0];
    expect(sent?.url).toBe('https://chatgpt.com/backend-api/codex/responses');
    expect(sent?.headers.get('authorization')).toBe('Bearer seat-access-token');
    expect(sent?.headers.get('chatgpt-account-id')).toBe('acct-1');
  });

  it('answers 429 with a usage-limit message when the match may not spend', async () => {
    const { deps, recorded } = harness({ access: { ok: false, reason: 'match is halted' } });
    const response = await serveModel(
      new Request('http://model.internal/v1/responses', { method: 'POST', body: '{}' }),
      deps,
    );
    expect(response.status).toBe(429);
    expect(await response.text()).toContain('usage limit');
    expect(recorded.requests).toHaveLength(0);
  });

  it('refuses a seat leased to another agent', async () => {
    const { deps } = harness({
      access: { ok: true, credential: { mode: 'lease', seat: 'default' }, holder: 'm-test:a1' },
      grant: { ok: false, reason: 'seat default is leased to another agent' },
    });
    const response = await serveModel(
      new Request('http://model.internal/backend-api/codex/responses', { method: 'POST' }),
      deps,
    );
    expect(response.status).toBe(401);
  });
});

describe('control.internal', () => {
  it('rejects unknown routes', async () => {
    const { deps } = harness({});
    const response = await serveControl(new Request('http://control.internal/v1/nope'), deps);
    expect(response.status).toBe(404);
  });
});
