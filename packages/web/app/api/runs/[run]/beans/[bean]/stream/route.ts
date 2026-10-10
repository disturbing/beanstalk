import { getUser } from '../../../../../../../src/auth/user';
import { mayViewEngine } from '../../../../../../../src/repositories/engine-guard';
import { env } from 'cloudflare:workers';

import { RunId, TaskId } from '@gitstalk/shared-race/ids';

import { beanStreamView } from '@gitstalk/shared-ask/forge/bean-stream';
import { isForgeError } from '@gitstalk/shared-ask/forge/forge-errors';
import { log } from '../../../../../../../src/log';
import { isRecordedRun } from '../../../../../../../src/recorded/recorded-runs';

type Context = { readonly params: Promise<{ readonly run: string; readonly bean: string }> };

/**
 * `GET /api/runs/:run/beans/:bean/stream`: the bean's latest streamed change while its agent
 * writes (`stream_diffs`), as file diffs; `{ stream: null }` when nothing streams.
 */
export async function GET(request: Request, context: Context): Promise<Response> {
  const params = await context.params;
  const run = RunId.safeParse(params.run);
  const bean = TaskId.safeParse(params.bean);
  if (!run.success || !bean.success) return problem(400, 'not a run or a bean id');
  if (!(await mayViewEngine(env.GATEWAY, run.data, (await getUser(request))?.id ?? null)))
    return problem(404, 'no such run');
  if (isRecordedRun(run.data)) return Response.json({ stream: null });
  try {
    const stream = await beanStreamView(env.GATEWAY, run.data, bean.data);
    return Response.json({ stream }, { headers: { 'cache-control': 'no-store' } });
  } catch (error: unknown) {
    if (isForgeError(error, 'not_found')) return problem(404, error.message);
    log.error('bean stream failed', { run: run.data, bean: bean.data, error });
    return problem(502, 'the gateway could not serve this stream');
  }
}

function problem(status: number, message: string): Response {
  return Response.json({ error: { message } }, { status });
}
