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
import { repoRoutes } from './routes/repos';
import { liveRoutes } from './routes/live';
import { collaborationRoutes } from './routes/collaboration';
import { whoamiRoutes } from './routes/whoami';
import { actionsRoutes, githubShapedGitUrl } from './routes/actions';
import { OIDC_PATH, oidcRoutes } from './actions/oidc';

/** The gateway's HTTP surface (§4): admin and driver API, git proxy, live page. */
export function createApp(depsFor: (env: Env) => Deps) {
  const app = new Hono<AppEnv>();
  app.use(requestContext(depsFor));
  app.use(accessLog);
  app.get('/healthz', (c) => c.json({ ok: true }));
  app.route('/git', gitRoutes);
  app.route('/v1/runs', adminRoutes);
  app.route('/v1/runs', readRoutes);
  app.route('/v1/runs', driverRoutes);
  app.route('/v1/runs', collaborationRoutes);
  app.route('/v1/admin', guardRoutes);
  app.route('/v1/whoami', whoamiRoutes);
  app.route('/v1/repos', repoRoutes);
  app.route('/runs', liveRoutes);
  app.route('/v1/actions', actionsRoutes);
  // The Actions OIDC issuer (src/actions/oidc.ts): discovery, JWKS and the job token endpoint.
  app.mount(OIDC_PATH, (request, env: Env) => oidcRoutes(env)(request));
  // Actions' checkout: `<server>/<owner>/<repo>[.git]/…` served as `/git/<owner>/<repo>.git/…`.
  app.all('/:owner/:repo/*', async (c, next) => {
    const rewritten = githubShapedGitUrl(new URL(c.req.url));
    if (rewritten === null) return next();
    return app.fetch(new Request(rewritten, c.req.raw), c.env, c.executionCtx);
  });
  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'no such route' } }, 404));
  app.onError(onError);
  return app;
}

export type AppType = ReturnType<typeof createApp>;

function onError(error: Error, c: Context<AppEnv>): Response {
  if (error instanceof HTTPException) {
    // Body-limit (413) and malformed-JSON (400) failures come from Hono's own middleware.
    return c.json(
      { error: { code: httpErrorCode(error.status), message: error.message } },
      error.status,
    );
  }
  if (error instanceof GatewayError) {
    if (error.status >= 500)
      c.var.deps.log.error('request failed', { requestId: c.var.requestId, error });
    return c.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  c.var.deps.log.error('unhandled error', { requestId: c.var.requestId, error });
  return c.json({ error: { code: 'internal', message: 'internal error' } }, 500);
}

function httpErrorCode(status: number): string {
  if (status === 400) return 'invalid_request';
  if (status === 413) return 'payload_too_large';
  return `http_${status}`;
}
