import { mayStreamRun } from '../../../../../src/admin/admin-gate';
import { env } from 'cloudflare:workers';

import { RunId } from '@gitstalk/shared-race/ids';

import { asGatewayBinding } from '@gitstalk/shared-ask/forge/gateway-rpc';
import { resumeCursor } from '../../../../../src/race/live-cursor';
import { liveEventStream } from '../../../../../src/live/live-bridge';
import { log } from '../../../../../src/log';
import { isRecordedRun } from '../../../../../src/recorded/recorded-runs';

type Context = { readonly params: Promise<{ readonly run: string }> };

/**
 * `GET /api/runs/:run/live?after=<seq>`: a live run's new events as Server-Sent Events,
 * bridged from the gateway's WebSocket feed through the service binding.
 */
export async function GET(request: Request, context: Context): Promise<Response> {
  const run = RunId.safeParse((await context.params).run);
  if (!run.success) return problem(400, 'not a run id');
  // A repository's engine to its readers; a benchmark race to platform admins only.
  if (!(await mayStreamRun(request, run.data))) return problem(404, 'no such run');
  if (isRecordedRun(run.data))
    return problem(404, 'a recorded run replays in the browser; it has no live feed');
  const binding = asGatewayBinding(env.GATEWAY);
  if (binding === undefined) return problem(503, 'no gateway is bound');
  const after = resumeCursor(request);
  try {
    const stream = await liveEventStream({
      binding,
      run: run.data,
      after,
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
    log.error('live feed failed', { run: run.data, error });
    return problem(502, 'the gateway did not open the live feed');
  }
}

function problem(status: number, message: string): Response {
  return Response.json({ error: { message } }, { status });
}
