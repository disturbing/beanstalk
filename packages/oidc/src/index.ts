import { WorkerEntrypoint } from 'cloudflare:workers';

import { createApp } from './app';

export default class Oidc extends WorkerEntrypoint<Env> {
  override fetch(request: Request): Promise<Response> | Response {
    return createApp().fetch(request, this.env, this.ctx);
  }
}
