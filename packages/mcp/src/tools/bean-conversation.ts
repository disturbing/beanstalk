import type {
  BeanContext,
  BeanContextInput,
  BeanPeerSummary,
} from '@gitstalk/shared-race/collaboration';
import type { TaskId } from '@gitstalk/shared-race/ids';

import { selectCollaborationContext } from '@gitstalk/shared-ask/collaboration/context';
import type { PeerContext } from '@gitstalk/shared-ask/collaboration/context';
import { beanContext, beanPeerSummaries } from './collaboration';
import { discoverBeanCandidates } from './bean-discovery';
import type { ToolContext } from './tool-context';

const MAX_CONTEXT_CANDIDATES = 16;
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
    candidates: fetched.peers.map((peer) => ({
      context: peerContext(peer),
      observed_paths: sources.observed.get(peer.bean) ?? [],
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

/** One read for every peer: excerpts and agreements, without any event history. */
async function hydrate(ctx: ToolContext, beans: readonly TaskId[]) {
  if (beans.length === 0) return { peers: [], unavailable: [] };
  const peers = await beanPeerSummaries(ctx, beans);
  const found = new Set<string>(peers.map((peer) => peer.bean));
  return { peers, unavailable: beans.filter((bean) => !found.has(bean)) };
}

function peerContext(peer: BeanPeerSummary): PeerContext {
  return {
    bean: {
      bean: peer.bean,
      revision: peer.revision,
      intent: peer.intent,
      approach:
        peer.approach_summary === null
          ? null
          : { summary: peer.approach_summary, paths: peer.paths },
    },
    promises: peer.promises.map((promise) => ({ ...promise, bean: peer.bean })),
    reliance: peer.reliance,
    current_cursor: peer.current_cursor,
    truncated: false,
    cut: { intent: peer.intent_truncated, approach: peer.approach_summary_truncated },
  };
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
