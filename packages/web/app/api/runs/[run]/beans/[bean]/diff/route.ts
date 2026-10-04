import { env } from 'cloudflare:workers';

import { RunId, TaskId } from '@beanstalk/shared-race/ids';

import { isForgeError } from '@beanstalk/shared-ask/forge/forge-errors';
import { forgeForRun } from '../../../../../../../src/forge/sources';
import { log } from '../../../../../../../src/log';

type Context = { readonly params: Promise<{ readonly run: string; readonly bean: string }> };

/** A bean's own diff (its landing, or its newest head against the line), for decision cards. */
export async function GET(_request: Request, context: Context): Promise<Response> {
  const params = await context.params;
  const run = RunId.safeParse(params.run);
  const bean = TaskId.safeParse(params.bean);
  if (!run.success || !bean.success) return problem(400, 'not a run or a bean id');
  try {
    const source = forgeForRun(env.GATEWAY, run.data);
    const detail = await source.beanDetail(run.data, bean.data);
    if (detail === undefined) return problem(404, `no bean ${bean.data} in this run`);
    if (detail.diffBase === null || detail.diffHead === null)
      return problem(404, 'this bean has no change yet');
    const diff = await source.repoDiff(run.data, detail.diffBase, detail.diffHead);
    return Response.json(diff, { headers: { 'cache-control': 'private, max-age=30' } });
  } catch (error: unknown) {
    if (isForgeError(error, 'not_found')) return problem(404, error.message);
    log.error('bean diff failed', { run: run.data, bean: bean.data, error });
    return problem(502, 'the gateway could not produce this diff');
  }
}

function problem(status: number, message: string): Response {
  return Response.json({ error: { message } }, { status });
}
