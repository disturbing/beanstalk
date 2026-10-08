import { Hono } from 'hono';

import { DEFAULT_ISSUER_PATH, createOidcApp, loadOidcConfig } from '@beanstalk/shared-oidc/issuer';

import type { OidcConfig } from '@beanstalk/shared-oidc/issuer';

export type AppEnv = { Bindings: Env };

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get('/healthz', (c) => c.json({ ok: true }));
  app.mount(DEFAULT_ISSUER_PATH, (request, env, ctx) => {
    const issuer = createOidcApp((incoming) => configFor(incoming, env));
    return issuer.fetch(request, env, ctx);
  });
  return app;
}

function configFor(request: Request, env: Env): Promise<OidcConfig> {
  return loadOidcConfig(env, new URL(request.url).origin);
}
