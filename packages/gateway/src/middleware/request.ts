import { createMiddleware } from 'hono/factory';

import type { AppEnv } from '../app-env';
import type { Deps } from '../deps';

/** Puts the request id (Cloudflare's ray id when present) and the deps on the context. */
export function requestContext(deps: Deps) {
  return createMiddleware<AppEnv>(async (c, next) => {
    c.set('requestId', c.req.header('cf-ray') ?? crypto.randomUUID());
    c.set('deps', deps);
    await next();
  });
}

/** One structured line per request, after it completes. Never logs bodies or credentials. */
export const accessLog = createMiddleware<AppEnv>(async (c, next) => {
  const started = Date.now();
  await next();
  c.var.deps.log.info('request', {
    requestId: c.var.requestId,
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    status: c.res.status,
    ms: Date.now() - started,
  });
});
