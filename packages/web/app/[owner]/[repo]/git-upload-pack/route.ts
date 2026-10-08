import { env } from 'cloudflare:workers';

import { forwardGit } from '../../../../src/git/git-host';

type Context = { readonly params: Promise<{ readonly owner: string; readonly repo: string }> };

/** Clone and fetch on the web host, forwarded to the gateway (src/git/git-host.ts). */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { owner, repo } = await context.params;
  return forwardGit(env.GATEWAY, request, { owner, repo, service: 'git-upload-pack' });
}
