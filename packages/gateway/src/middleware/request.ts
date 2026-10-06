import { createMiddleware } from 'hono/factory';

import type { AppEnv } from '../app-env';
import type { Deps } from '../deps';
import { createLogger } from '../log';

/**
 * Puts the request id (Cloudflare's ray id when present) and the deps on the context. The
 * app is built once; the deps come from the request's env. A misconfigured deployment
 * (bad vars or short secrets) answers 500 and logs why, once per request.
 */
export function requestContext(depsFor: (env: Env) => Deps) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const requestId = c.req.header('cf-ray') ?? crypto.randomUUID();
    c.set('requestId', requestId);
    let deps: Deps;
    try {
      deps = depsFor(c.env);
    } catch (error: unknown) {
      createLogger('error', { component: 'gateway' }).error('misconfigured deployment', {
        requestId,
        error,
      });
      return c.json({ error: { code: 'misconfigured', message: 'gateway is misconfigured' } }, 500);
    }
    c.set('deps', deps);
    await next();
    return undefined;
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
