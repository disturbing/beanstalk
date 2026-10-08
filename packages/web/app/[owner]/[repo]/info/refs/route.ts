import { env } from 'cloudflare:workers';

import { forwardGit } from '../../../../../src/git/git-host';

type Context = { readonly params: Promise<{ readonly owner: string; readonly repo: string }> };

/** Git's ref advertisement on the web host, forwarded to the gateway (src/git/git-host.ts). */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { owner, repo } = await context.params;
  return forwardGit(env.GATEWAY, request, { owner, repo, service: 'info/refs' });
}
