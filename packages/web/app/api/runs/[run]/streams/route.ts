import { getUser } from '../../../../../src/auth/user';
import { mayViewEngine } from '../../../../../src/repositories/engine-guard';
import { env } from 'cloudflare:workers';
import { z } from 'zod';

import { RunId, TaskId } from '@gitstalk/shared-race/ids';

import { asGatewayBinding } from '@gitstalk/shared-ask/forge/gateway-rpc';
import { liveStreamFeed } from '../../../../../src/live/stream-bridge';
import { log } from '../../../../../src/log';
import { isRecordedRun } from '../../../../../src/recorded/recorded-runs';

type Context = { readonly params: Promise<{ readonly run: string }> };

/** Beans one reader may watch at once (the gateway's limit per socket). */
const MAX_BEANS = 32;

const Beans = z.array(TaskId).max(MAX_BEANS);

/**
 * `GET /api/runs/:run/streams?beans=t012,t015`: a live run's streaming diffs
 * (`stream_diffs`) as Server-Sent Events, bridged from the gateway's stream socket through
 * the service binding: every bean's summary, and the snapshot then the patches of the beans
 * named. Separate from the events feed, so a reader who changes bean reconnects only this.
 */
export async function GET(request: Request, context: Context): Promise<Response> {
  const run = RunId.safeParse((await context.params).run);
  if (!run.success) return problem(400, 'not a run id');
  if (!(await mayViewEngine(env.GATEWAY, run.data, (await getUser(request))?.id ?? null)))
    return problem(404, 'no such run');
  if (isRecordedRun(run.data))
    return problem(404, 'a recorded run replays in the browser; nothing streams');
  const beans = Beans.safeParse(beanList(request));
  if (!beans.success) return problem(400, `beans: up to ${MAX_BEANS} bean ids`);
  const binding = asGatewayBinding(env.GATEWAY);
  if (binding === undefined) return problem(503, 'no gateway is bound');
  try {
    const stream = await liveStreamFeed({
      binding,
      run: run.data,
      beans: beans.data,
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
    log.error('stream feed failed', { run: run.data, error });
    return problem(502, 'the gateway did not open the stream feed');
  }
}

function beanList(request: Request): readonly string[] {
  const raw = new URL(request.url).searchParams.get('beans') ?? '';
  return [...new Set(raw.split(',').filter((bean) => bean !== ''))];
}

function problem(status: number, message: string): Response {
  return Response.json({ error: { message } }, { status });
}
