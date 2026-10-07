import { env } from 'cloudflare:workers';

import { setupConfig } from '../../../src/setup/setup-api';

/** Where git and SSH live for this deployment: what the setup script points git at. */
export function GET(request: Request): Response {
  return Response.json(setupConfig(env, new URL(request.url).origin), {
    headers: { 'cache-control': 'no-store' },
  });
}
