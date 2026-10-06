import { Hono } from 'hono';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';

import type { AppEnv } from './app-env';
import { requireAdmin } from './auth';
import { loggerFor } from './config';
import { adminRoutes, seatRoutes } from './routes/admin';
import { matchRoutes } from './routes/matches';

/** beanstalk-swarm's HTTP surface: matches, seats and the halt switch, all behind the admin token. */
export function createApp() {
  const app = new Hono<AppEnv>();
  app.use(async (c, next) => {
    c.set('log', loggerFor(c.env, 'swarm'));
    await next();
  });
  app.get('/healthz', (c) => c.json({ ok: true }));
  app.use('/v1/*', requireAdmin);
  app.route('/v1/matches', matchRoutes);
  app.route('/v1/seats', seatRoutes);
  app.route('/v1/admin', adminRoutes);
  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'no such route' } }, 404));
  app.onError(onError);
  return app;
}

function onError(error: Error, c: Context<AppEnv>): Response {
  if (error instanceof HTTPException) {
    return c.json({ error: { code: 'bad_request', message: error.message } }, error.status);
  }
  c.var.log.error('request failed', { path: new URL(c.req.url).pathname, error });
  return c.json({ error: { code: 'internal', message: 'internal error' } }, 500);
}
