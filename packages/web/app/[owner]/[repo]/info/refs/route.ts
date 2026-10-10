import { env } from 'cloudflare:workers';

import { resolveRetiredHandle } from '@gitstalk/shared-identity/profiles';

import { forwardGit, movedGitLocation } from '../../../../../src/git/git-host';

type Context = { readonly params: Promise<{ readonly owner: string; readonly repo: string }> };

/**
 * Git's ref advertisement on the web host, forwarded to the gateway (src/git/git-host.ts). An
 * owner who changed handle is redirected first, so remotes with the old handle keep working.
 */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { owner, repo } = await context.params;
  const moved = await resolveRetiredHandle(env, decodeURIComponent(owner));
  if (moved !== null)
    return Response.redirect(movedGitLocation(request.url, decodeURIComponent(owner), moved), 301);
  return forwardGit(env.GATEWAY, request, { owner, repo, service: 'info/refs' });
}
