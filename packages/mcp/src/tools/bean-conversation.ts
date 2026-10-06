import type { BeanContext, BeanContextInput } from '@beanstalk/shared-race/collaboration';
import type { TaskId } from '@beanstalk/shared-race/ids';

import { selectCollaborationContext } from '@beanstalk/shared-ask/collaboration/context';
import { beanContext } from './collaboration';
import { discoverBeanCandidates } from './bean-discovery';
import type { ToolContext } from './tool-context';

const MAX_CONTEXT_CANDIDATES = 16;
const CANDIDATE_HISTORY_LIMIT = 20;
const MAX_EXPANSION_HANDLES = 32;

/** Canonical records plus bounded lexical context. Exact references bypass relevance ranking. */
export async function beanConversation(ctx: ToolContext, input: BeanContextInput) {
  const focus = await beanContext(ctx, input);
  try {
    const related = await relatedContext(ctx, focus);
    return { ...focus, related_context: { status: 'available', ...related } };
  } catch (error: unknown) {
    ctx.log?.warn('related bean context unavailable', { run: ctx.run, bean: input.bean, error });
    return {
      ...focus,
      related_context: {
        status: 'unavailable',
        summary: 'Read explicitly referenced beans with bean_context.',
      },
    };
  }
}

async function relatedContext(ctx: ToolContext, focus: BeanContext) {
  const sources = await discoverBeanCandidates(ctx, focus);
  const required = requiredBeans(focus);
  const candidates = [...new Set([...required, ...sources.beans])].filter(
    (bean) => bean !== focus.bean.bean,
  );
  const fetched = await hydrate(ctx, candidates.slice(0, MAX_CONTEXT_CANDIDATES));
  const selection = selectCollaborationContext({
    focus,
    observed_paths: sources.focusPaths,
    candidates: fetched.contexts.map((context) => ({
      context,
      observed_paths: sources.observed.get(context.bean.bean) ?? [],
    })),
  });
  return {
    ...selection,
    discovery: sources.discovery,
    candidate_count: candidates.length,
    hydration_limit: MAX_CONTEXT_CANDIDATES,
    unfetched: candidates.slice(
      MAX_CONTEXT_CANDIDATES,
      MAX_CONTEXT_CANDIDATES + MAX_EXPANSION_HANDLES,
    ),
    unfetched_count: Math.max(0, candidates.length - MAX_CONTEXT_CANDIDATES),
    unavailable: fetched.unavailable,
    expansion_truncated:
      selection.expansion_truncated ||
      candidates.length - MAX_CONTEXT_CANDIDATES > MAX_EXPANSION_HANDLES,
    truncated:
      selection.truncated ||
      sources.truncated ||
      candidates.length > MAX_CONTEXT_CANDIDATES ||
      fetched.unavailable.length > 0,
  };
}

async function hydrate(ctx: ToolContext, beans: readonly TaskId[]) {
  const outcomes = await Promise.allSettled(
    beans.map((bean) => beanContext(ctx, { bean, limit: CANDIDATE_HISTORY_LIMIT })),
  );
  const contexts: BeanContext[] = [];
  const unavailable: TaskId[] = [];
  for (const [index, outcome] of outcomes.entries()) {
    if (outcome.status === 'fulfilled') contexts.push(outcome.value);
    else {
      const bean = beans[index];
      if (bean !== undefined) unavailable.push(bean);
      ctx.log?.warn('related bean read failed', { run: ctx.run, bean, error: outcome.reason });
    }
  }
  return { contexts, unavailable };
}

function requiredBeans(focus: BeanContext): readonly TaskId[] {
  return [
    ...new Set([
      ...focus.reliance.map((reference) => reference.bean),
      ...focus.history.flatMap((event) => {
        if (event.kind !== 'thread.posted') return [];
        const requestAuthor =
          event.post.kind === 'request' && event.post.bean === focus.bean.bean
            ? [event.post.author_bean]
            : [];
        return [...requestAuthor, ...event.post.references.map((reference) => reference.bean)];
      }),
    ]),
  ];
}
