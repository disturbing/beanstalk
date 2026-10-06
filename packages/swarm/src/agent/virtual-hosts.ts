import type { SeatGrant } from '../broker/broker-do';
import { loggerFor, swarmConfig } from '../config';
import type { ModelAccess, SlotConfigReply, SlotHello } from '../match/match-do';
import type { AgentAssignment } from './assignment';

/**
 * The virtual hosts an agent container can reach, all plain HTTP to this Worker (the container
 * has no internet and no other name resolves):
 *
 * - `control.internal`: the swarm itself (hello, slot config after the shared start, logs,
 *   transcripts, exit);
 * - `bs.internal`: the gateway's driver routes and git proxy for this slot's run only, over the
 *   service binding, with the slot token added here (refreshed tokens are taken out of `next`
 *   answers, so the container never holds one);
 * - `model.internal`: the model API, with the API key or the leased ChatGPT seat added here.
 */
export const CONTROL_HOST = 'control.internal';
export const GATEWAY_HOST = 'bs.internal';

export type AgentPort = {
  assignment(): Promise<AgentAssignment | null>;
  setToken(token: string): Promise<void>;
  touch(): Promise<void>;
};

export type MatchPort = {
  hello(slot: string, info: SlotHello): Promise<void>;
  slotConfig(slot: string): Promise<SlotConfigReply>;
  appendLog(slot: string, text: string): Promise<boolean>;
  putFile(slot: string, name: string, content: ArrayBuffer): Promise<void>;
  slotExited(slot: string, code: number | null): Promise<void>;
  recordSpend(invocation: string, usd: number): Promise<void>;
  modelAccess(slot: string): Promise<ModelAccess>;
  reissueTokens(): Promise<boolean>;
};

export type BrokerPort = { lease(name: string, holder: string): Promise<SeatGrant> };

export type HostDeps = {
  readonly env: Env;
  readonly agent: AgentPort;
  readonly matchOf: (match: string) => MatchPort;
  readonly broker: BrokerPort;
  readonly gateway: { fetch(request: Request): Promise<Response> };
  readonly upstream: (request: Request) => Promise<Response>;
};

const LOG_BODY_LIMIT = 4 * 1024 * 1024;
const FILE_BODY_LIMIT = 1024 * 1024;
const FILE_NAME = /^[A-Za-z0-9._-]{1,120}$/;

// ---- control.internal ----------------------------------------------------------------------------

export async function serveControl(request: Request, deps: HostDeps): Promise<Response> {
  const assignment = await deps.agent.assignment();
  if (assignment === null) return problem(409, 'unassigned', 'this container has no slot');
  await deps.agent.touch();
  const match = deps.matchOf(assignment.match);
  const { pathname } = new URL(request.url);
  const route = `${request.method} ${pathname}`;
  if (route === 'POST /v1/hello') {
    const body = await jsonBody(request);
    await match.hello(assignment.slot, {
      codexVersion: stringOrNull(body['codex_version']),
      harness: stringOrNull(body['harness']),
    });
    return Response.json({ ok: true, slot: assignment.slot });
  }
  if (route === 'GET /v1/config') return Response.json(await match.slotConfig(assignment.slot));
  if (route === 'POST /v1/log') {
    const text = await request.text();
    if (text.length > LOG_BODY_LIMIT) return problem(413, 'too_large', 'log chunk too large');
    const kept = await match.appendLog(assignment.slot, text);
    return Response.json({ ok: kept });
  }
  const file = /^\/v1\/files\/([^/]+)$/.exec(pathname)?.[1];
  if (request.method === 'POST' && file !== undefined && FILE_NAME.test(file)) {
    const content = await request.arrayBuffer();
    if (content.byteLength > FILE_BODY_LIMIT) return problem(413, 'too_large', 'file too large');
    await match.putFile(assignment.slot, file, content);
    return Response.json({ ok: true });
  }
  if (route === 'POST /v1/exit') {
    const body = await jsonBody(request);
    const code = typeof body['code'] === 'number' ? body['code'] : null;
    await match.slotExited(assignment.slot, code);
    return Response.json({ ok: true });
  }
  return problem(404, 'not_found', 'no such control route');
}

// ---- bs.internal ----------------------------------------------------------------------------------

export type GatewayRoute =
  | { readonly kind: 'next' }
  | { readonly kind: 'invocation'; readonly invocation: string; readonly action: string }
  | { readonly kind: 'git' };

/** The gateway routes a slot may call: its own `next`, its run's invocation posts, git. */
export function gatewayRoute(
  method: string,
  pathname: string,
  run: string,
  slot: string,
): GatewayRoute | null {
  if (pathname.startsWith('/git/') && !pathname.includes('..')) {
    return method === 'GET' || method === 'POST' ? { kind: 'git' } : null;
  }
  if (method !== 'POST') return null;
  if (pathname === `/v1/runs/${run}/agents/${slot}/next`) return { kind: 'next' };
  const match =
    /^\/v1\/runs\/([^/]+)\/invocations\/([A-Za-z0-9_-]+)\/(result|progress|stream)$/.exec(pathname);
  if (match?.[1] === run && match[2] !== undefined && match[3] !== undefined) {
    return { kind: 'invocation', invocation: match[2], action: match[3] };
  }
  return null;
}

export async function serveGateway(request: Request, deps: HostDeps): Promise<Response> {
  const assignment = await deps.agent.assignment();
  if (assignment === null) return problem(409, 'unassigned', 'this container has no slot');
  await deps.agent.touch();
  const url = new URL(request.url);
  const route = gatewayRoute(request.method, url.pathname, assignment.run, assignment.slot);
  if (route === null) return problem(403, 'forbidden_route', 'not a route this slot may call');
  const match = deps.matchOf(assignment.match);
  if (route.kind === 'git') {
    // Streamed through (packs); git retries on its own, and a 401 re-issues for the next try.
    const response = await deps.gateway.fetch(
      forwarded(request, url, assignment.token, request.body),
    );
    if (response.status === 401) await match.reissueTokens();
    return response;
  }
  const body = await request.arrayBuffer();
  if (route.kind === 'invocation' && route.action !== 'stream') {
    const cost = costOf(body);
    if (cost !== null) await match.recordSpend(route.invocation, cost);
  }
  let response = await deps.gateway.fetch(forwarded(request, url, assignment.token, body));
  if (response.status === 401 && (await match.reissueTokens())) {
    const fresh = await deps.agent.assignment();
    if (fresh !== null) {
      response = await deps.gateway.fetch(forwarded(request, url, fresh.token, body));
    }
  }
  if (route.kind !== 'next' || !response.ok) return response;
  return withoutToken(response, deps.agent);
}

/** A `next` answer with its refreshed slot token taken out and kept for this container. */
async function withoutToken(response: Response, agent: AgentPort): Promise<Response> {
  const reply: unknown = await response.json();
  if (typeof reply !== 'object' || reply === null) return Response.json(reply);
  const refresh: unknown = Reflect.get(reply, 'token');
  if (typeof refresh === 'object' && refresh !== null) {
    const token: unknown = Reflect.get(refresh, 'token');
    if (typeof token === 'string' && token !== '') await agent.setToken(token);
    Reflect.deleteProperty(reply, 'token');
  }
  return Response.json(reply, { status: response.status });
}

function forwarded(request: Request, url: URL, token: string, body: BodyInit | null): Request {
  const headers = cleanHeaders(request.headers, ['authorization']);
  headers.set('authorization', `Bearer ${token}`);
  return new Request(`http://${GATEWAY_HOST}${url.pathname}${url.search}`, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? null : body,
  });
}

function costOf(body: ArrayBuffer): number | null {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(body));
    const cost: unknown =
      typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'cost_usd') : null;
    return typeof cost === 'number' && Number.isFinite(cost) ? cost : null;
  } catch {
    return null;
  }
}

// ---- model.internal -------------------------------------------------------------------------------

const CHATGPT_PREFIX = '/backend-api/codex';

export async function serveModel(request: Request, deps: HostDeps): Promise<Response> {
  const assignment = await deps.agent.assignment();
  if (assignment === null) return modelProblem(403, 'this container has no slot');
  await deps.agent.touch();
  const access = await deps.matchOf(assignment.match).modelAccess(assignment.slot);
  // "usage limit" and 429 are what the race driver treats as an infra pause, never agent work.
  if (!access.ok) return modelProblem(429, `swarm usage limit: ${access.reason}`);
  const config = swarmConfig(deps.env);
  const url = new URL(request.url);
  const log = loggerFor(deps.env, 'model-host').with({
    match: assignment.match,
    slot: assignment.slot,
  });
  const headers = cleanHeaders(request.headers, ['authorization', 'chatgpt-account-id']);
  let target: string;
  switch (access.credential.mode) {
    case 'none':
      return modelProblem(403, 'this match runs no model');
    case 'api-key': {
      if (!url.pathname.startsWith('/v1/')) return modelProblem(404, 'not a model route');
      if (config.openaiApiKey === null) {
        return modelProblem(401, 'Incorrect API key provided: the swarm has no OPENAI_API_KEY');
      }
      headers.set('authorization', `Bearer ${config.openaiApiKey}`);
      target = `${config.modelUpstream}${url.pathname.slice(3)}${url.search}`;
      break;
    }
    case 'lease': {
      if (!url.pathname.startsWith(`${CHATGPT_PREFIX}/`)) {
        return modelProblem(404, 'not a model route');
      }
      const grant = await deps.broker.lease(access.credential.seat, access.holder);
      if (!grant.ok) return modelProblem(401, `seat unavailable: ${grant.reason}`);
      headers.set('authorization', `Bearer ${grant.accessToken}`);
      headers.set('chatgpt-account-id', grant.accountId);
      target = `${config.chatgptUpstream}${url.pathname.slice(CHATGPT_PREFIX.length)}${url.search}`;
      break;
    }
  }
  const started = Date.now();
  const response = await deps.upstream(
    new Request(target, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? null : request.body,
    }),
  );
  log.info('model request', {
    mode: access.credential.mode,
    method: request.method,
    path: url.pathname,
    status: response.status,
    ms: Date.now() - started,
  });
  return new Response(response.body, {
    status: response.status,
    headers: cleanHeaders(response.headers, ['set-cookie']),
  });
}

function modelProblem(status: number, message: string): Response {
  return Response.json(
    { error: { message, type: 'swarm_error', code: `swarm_${status}` } },
    { status },
  );
}

// ---- shared -----------------------------------------------------------------------------------------

const HOP_HEADERS = [
  'host',
  'cookie',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-length',
  'cf-connecting-ip',
  'cf-ray',
  'cf-ipcountry',
  'cf-visitor',
  'x-forwarded-for',
  'x-forwarded-proto',
  'x-real-ip',
];

/** A copy of `headers` without hop-by-hop, client-identity and the named headers. */
export function cleanHeaders(headers: Headers, drop: readonly string[]): Headers {
  const out = new Headers();
  const dropped = new Set([...HOP_HEADERS, ...drop]);
  headers.forEach((value, name) => {
    if (!dropped.has(name.toLowerCase())) out.set(name, value);
  });
  return out;
}

async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await request.json();
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? Object.fromEntries(Object.entries(parsed))
      : {};
  } catch {
    return {};
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value.slice(0, 200) : null;
}

function problem(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}
