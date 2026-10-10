/**
 * The web Worker's entry: vinext's App Router handler, with the marketing site's paths handed
 * to the site Worker when this deployment binds it as SITE (one origin for both, e.g.
 * gitstalk.io; `scripts/environments.mjs` adds the binding when `urls.site` equals `urls.web`).
 * Without SITE every request goes to the app, exactly as vinext's default entry does.
 */
import app from 'vinext/server/app-router-entry';

import { isSitePath } from '../src/site/forward';

/** The optional binding: generated only for environments that serve the site here. */
type SiteBinding = { readonly SITE?: { fetch(request: Request): Promise<Response> } };

type AppEnv = Parameters<typeof app.fetch>[1];
type AppContext = Parameters<typeof app.fetch>[2];

export default {
  __ensureInstrumentation: app.__ensureInstrumentation,
  async fetch(request: Request, env: AppEnv & SiteBinding, ctx: AppContext): Promise<Response> {
    if (env?.SITE && isSitePath(request)) return env.SITE.fetch(request);
    return app.fetch(request, env, ctx);
  },
};
