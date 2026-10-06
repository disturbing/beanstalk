import { BeanDiscoverPage } from '@beanstalk/shared-race/collaboration';
import type { BeanContext } from '@beanstalk/shared-race/collaboration';

import { BeanDetailAnswer, BeanSummaries, unwrap } from '@beanstalk/shared-ask/forge/gateway-rpc';

import type { ToolContext } from './tool-context';
import { parseBean } from './tool-context';

const MAX_DECLARED_PATHS = 16;
const MAX_OBSERVED_PATHS = 100;

/** Independent sources fail independently; direct promise/request hydration remains usable. */
export async function discoverBeanCandidates(ctx: ToolContext, focus: BeanContext) {
  const [observed, declared] = await Promise.allSettled([
    observedCandidates(ctx, focus),
    declaredCandidates(ctx, focus),
  ]);
  for (const outcome of [observed, declared]) {
    if (outcome.status === 'rejected')
      ctx.log?.warn('bean discovery source unavailable', {
        run: ctx.run,
        bean: focus.bean.bean,
        error: outcome.reason,
      });
  }
  return {
    beans: [
      ...(declared.status === 'fulfilled' ? declared.value.beans : []),
      ...(observed.status === 'fulfilled' ? observed.value.beans : []),
    ],
    focusPaths: observed.status === 'fulfilled' ? observed.value.focusPaths : [],
    observed:
      observed.status === 'fulfilled'
        ? observed.value.observed
        : new Map<string, readonly string[]>(),
    discovery: {
      explicit_references: true,
      declared:
        declared.status === 'fulfilled' ? declared.value.discovery : { status: 'unavailable' },
      observed:
        observed.status === 'fulfilled' ? observed.value.discovery : { status: 'unavailable' },
    },
    truncated:
      observed.status === 'rejected' ||
      declared.status === 'rejected' ||
      (observed.status === 'fulfilled' && observed.value.truncated) ||
      (declared.status === 'fulfilled' && declared.value.truncated),
  };
}

async function declaredCandidates(ctx: ToolContext, focus: BeanContext) {
  const paths = declaredPaths(focus);
  if (typeof ctx.gateway.beanDiscover !== 'function')
    return { beans: [], truncated: false, discovery: { status: 'unsupported' } };
  const query = `${focus.bean.intent} ${focus.bean.approach?.summary ?? ''}`.trim();
  const page = unwrap(
    await ctx.gateway.beanDiscover(ctx.run, {
      bean: focus.bean.bean,
      paths: paths.slice(0, MAX_DECLARED_PATHS),
      ...(query.length === 0 ? {} : { query: query.slice(0, 500) }),
      limit: 32,
    }),
    BeanDiscoverPage,
  );
  return {
    beans: page.beans.map((bean) => bean.bean),
    truncated: page.truncated || paths.length > MAX_DECLARED_PATHS || query.length > 500,
    discovery: {
      status: 'available',
      candidates_truncated: page.truncated,
      paths_omitted: Math.max(0, paths.length - MAX_DECLARED_PATHS),
      query_truncated: query.length > 500,
    },
  };
}

async function observedCandidates(ctx: ToolContext, focus: BeanContext) {
  const detail = unwrap(await ctx.gateway.beanDetail(ctx.run, focus.bean.bean), BeanDetailAnswer);
  const paths = [...new Set([...declaredPaths(focus), ...detail.files])];
  const summaries =
    paths.length === 0
      ? []
      : unwrap(
          await ctx.gateway.beansByPath(ctx.run, paths.slice(0, MAX_OBSERVED_PATHS)),
          BeanSummaries,
        );
  return {
    beans: summaries.flatMap((summary) => parseBean(summary.bean) ?? []),
    focusPaths: detail.files,
    observed: new Map(summaries.map((summary) => [summary.bean, summary.files])),
    truncated: paths.length > MAX_OBSERVED_PATHS,
    discovery: {
      status: 'available',
      paths_omitted: Math.max(0, paths.length - MAX_OBSERVED_PATHS),
    },
  };
}

function declaredPaths(focus: BeanContext): readonly string[] {
  return [
    ...new Set([
      ...(focus.bean.approach?.paths ?? []),
      ...focus.promises.flatMap((promise) => promise.paths),
    ]),
  ];
}
