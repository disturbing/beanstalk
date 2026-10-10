/**
 * The run-token surface: stateless MCP over Streamable HTTP at `/mcp` behind a run-scoped
 * view or contributor token (`bst1.…`). OAuth sessions reach the same tools through
 * ./oauth/oauth-mcp.ts; ./index.ts routes between them. Every operation uses the gateway
 * service binding.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';

import type { AppEnv } from './app-env';
import { requireViewer } from './auth/bearer';
import type { Deps } from './deps';
import { MCP_ROUTE, serveMcp } from './mcp/serve';

export { MCP_ROUTE } from './mcp/serve';

/** The app, with dependencies built per request from the bindings (`depsFromEnv` in production). */
export function createApp(depsFor: (env: Env) => Deps) {
  const app = new Hono<AppEnv>();
  app.use(async (c, next) => {
    c.set('deps', depsFor(c.env));
    await next();
  });
  app.get('/', (c) =>
    c.json({
      name: 'gitstalk-mcp',
      mcp: MCP_ROUTE,
      auth: 'Authorization: Bearer <view or contributor token>, or OAuth 2.1',
    }),
  );
  app.all(MCP_ROUTE, requireViewer, serveRunTools);
  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'no such route' } }, 404));
  app.onError((error, c) => {
    c.var.deps.log.error('unhandled error', { error });
    return c.json({ error: { code: 'internal', message: 'internal error' } }, 500);
  });
  return app;
}

/** Hands the raw request to the Agents SDK's stateless handler, with the viewer's run bound in. */
function serveRunTools(c: Context<AppEnv>): Promise<Response> {
  const { gateway, log } = c.var.deps;
  const { run, sub, contributor } = c.var.viewer;
  if (gateway === undefined)
    throw new Error('requireViewer let a request through without a gateway');
  const workerCtx: unknown = c.executionCtx;
  if (!isWorkerContext(workerCtx)) throw new Error('the request has no Workers execution context');
  return serveMcp(c.req.raw, {
    env: c.env,
    ctx: workerCtx,
    gateway,
    log,
    caller: { run, sub, ...(contributor === undefined ? {} : { contributor }) },
  });
}

/** Hono types its context loosely; the handler wants the runtime's (it reads `props`). */
function isWorkerContext(value: unknown): value is ExecutionContext {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'waitUntil') === 'function'
  );
}
