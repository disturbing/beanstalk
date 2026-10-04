/**
 * beanstalk-mcp: read-only MCP tools for coding agents over one run of the forge
 * (`docs/claude-opus/06-auth-mcp-live-previews.md` §4).
 */
import { WorkerEntrypoint } from 'cloudflare:workers';

import { createApp } from './app';
import { depsFromEnv } from './deps';

const app = createApp(depsFromEnv);

export default class BeanstalkMcp extends WorkerEntrypoint<Env> {
  override fetch(request: Request): Promise<Response> {
    return Promise.resolve(app.fetch(request, this.env, this.ctx));
  }
}
