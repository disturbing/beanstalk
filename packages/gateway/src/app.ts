import { Hono } from 'hono';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';

import type { AppEnv } from './app-env';
import type { Deps } from './deps';
import { GatewayError } from './errors';
import { accessLog, requestContext } from './middleware/request';
import { adminRoutes, readRoutes } from './routes/admin';
import { driverRoutes } from './routes/driver';
import { gitRoutes } from './routes/git';
import { guardRoutes } from './routes/guards';
import { liveRoutes } from './routes/live';
import { collaborationRoutes } from './routes/collaboration';

/** The gateway's HTTP surface (§4): admin and driver API, git proxy, live page. */
export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>();
  app.use(requestContext(deps));
  app.use(accessLog);
  app.get('/healthz', (c) => c.json({ ok: true }));
  app.route('/git', gitRoutes);
  app.route('/v1/runs', adminRoutes);
  app.route('/v1/runs', readRoutes);
  app.route('/v1/runs', driverRoutes);
  app.route('/v1/runs', collaborationRoutes);
  app.route('/v1/admin', guardRoutes);
  app.route('/runs', liveRoutes);
  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'no such route' } }, 404));
  app.onError(onError);
  return app;
}

export type AppType = ReturnType<typeof createApp>;

function onError(error: Error, c: Context<AppEnv>): Response {
  if (error instanceof HTTPException) return error.getResponse();
  if (error instanceof GatewayError) {
    if (error.status >= 500)
      c.var.deps.log.error('request failed', { requestId: c.var.requestId, error });
    return c.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  c.var.deps.log.error('unhandled error', { requestId: c.var.requestId, error });
  return c.json({ error: { code: 'internal', message: 'internal error' } }, 500);
}
