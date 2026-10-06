/**
 * The MCP Worker's HTTP surface: stateless MCP over Streamable HTTP at `/mcp`, behind a
 * run-scoped view token. Every read goes to the gateway over its service binding.
 */
import { createMcpHandler } from 'agents/mcp/server';
import { Hono } from 'hono';
import type { Context } from 'hono';

import { classifierFrom } from '@beanstalk/shared-ask/ask/classifier-from-env';
import { pickerFrom } from '@beanstalk/shared-ask/pick/picker-from-env';
import { gatewaySource } from '@beanstalk/shared-ask/forge/gateway-source';
import { memoSource } from '@beanstalk/shared-ask/forge/memo-source';

import type { AppEnv } from './app-env';
import { requireViewer } from './auth/bearer';
import type { Deps } from './deps';
import { createServer } from './mcp/server';
import { toolContext } from './tools/tool-context';

export const MCP_ROUTE = '/mcp';

/** The app, with dependencies built per request from the bindings (`depsFromEnv` in production). */
export function createApp(depsFor: (env: Env) => Deps) {
  const app = new Hono<AppEnv>();
  app.use(async (c, next) => {
    c.set('deps', depsFor(c.env));
    await next();
  });
  app.get('/', (c) =>
    c.json({ name: 'beanstalk-mcp', mcp: MCP_ROUTE, auth: 'Authorization: Bearer <view token>' }),
  );
  app.all(MCP_ROUTE, requireViewer, serveMcp);
  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'no such route' } }, 404));
  app.onError((error, c) => {
    c.var.deps.log.error('unhandled error', { error });
    return c.json({ error: { code: 'internal', message: 'internal error' } }, 500);
  });
  return app;
}

/** Hands the raw request to the Agents SDK's stateless handler, with the viewer's run bound in. */
function serveMcp(c: Context<AppEnv>): Promise<Response> {
  const { gateway, log } = c.var.deps;
  const { run, sub } = c.var.viewer;
  if (gateway === undefined)
    throw new Error('requireViewer let a request through without a gateway');
  const ctx = toolContext({
    run,
    gateway,
    // Per request: repeated reads within one MCP call are shared, never across calls.
    source: memoSource(gatewaySource(gateway)),
    classifier: classifierFrom({
      name: c.env.ASK_CLASSIFIER,
      model: c.env.ASK_AI_MODEL,
      ai: Reflect.get(c.env, 'AI'),
    }),
    picker: pickerFrom({
      name: c.env.PICKER,
      ai: Reflect.get(c.env, 'AI'),
      gateway: c.env.JEV_GATEWAY,
      onError: (decision, error) =>
        log.warn('jev pick fell back to the rule', { run, decision, error }),
    }),
    webUrl: c.env.WEB_URL,
  });
  const handler = createMcpHandler(() => createServer(ctx), {
    route: MCP_ROUTE,
    onerror: (error) => log.error('mcp handler error', { run, sub, error }),
  });
  const workerCtx: unknown = c.executionCtx;
  if (!isWorkerContext(workerCtx)) throw new Error('the request has no Workers execution context');
  return handler(c.req.raw, c.env, workerCtx);
}

/** Hono types its context loosely; the handler wants the runtime's (it reads `props`). */
function isWorkerContext(value: unknown): value is ExecutionContext {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'waitUntil') === 'function'
  );
}
