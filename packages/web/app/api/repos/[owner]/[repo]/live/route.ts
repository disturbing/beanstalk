import { env } from 'cloudflare:workers';

import { RunId } from '@gitstalk/shared-race/ids';

import { asGatewayBinding } from '@gitstalk/shared-ask/forge/gateway-rpc';
import { currentUser } from '../../../../../../src/auth/user';
import { liveEventStream } from '../../../../../../src/live/live-bridge';
import { log } from '../../../../../../src/log';
import { resumeCursor } from '../../../../../../src/race/live-cursor';
import { lookupRepository } from '../../../../../../src/repositories/flows';
import { registryClient } from '../../../../../../src/repositories/registry-client';

type Context = { readonly params: Promise<{ readonly owner: string; readonly repo: string }> };

/**
 * `GET /api/repos/:owner/:repo/live?after=<seq>`: a repository's new engine events as
 * Server-Sent Events, for the viewers who may read the repository (the same 404 as its pages
 * for anyone else).
 */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { owner, repo } = await context.params;
  const user = await currentUser();
  const found = await lookupRepository(
    decodeURIComponent(owner),
    decodeURIComponent(repo),
    user,
    registryClient(env.GATEWAY),
  );
  if (found.kind === 'not-found') return problem(404, 'no such repository');
  const engine = RunId.safeParse(found.record.engine_id);
  const binding = asGatewayBinding(env.GATEWAY);
  if (!engine.success || binding === undefined) return problem(503, 'the engine is not reachable');
  try {
    const stream = await liveEventStream({
      binding,
      run: engine.data,
      after: resumeCursor(request),
      signal: request.signal,
    });
    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        'x-accel-buffering': 'no',
      },
    });
  } catch (error: unknown) {
    log.error('repository live feed failed', { engine: engine.data, error });
    return problem(502, 'the gateway did not open the live feed');
  }
}

function problem(status: number, message: string): Response {
  return Response.json({ error: { message } }, { status });
}
