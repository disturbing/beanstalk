import type {
  BeanContext,
  BeanPromise,
  PromiseReference,
  ThreadPost,
} from '@beanstalk/shared-race/collaboration';
import type { TaskId } from '@beanstalk/shared-race/ids';

import { compareText } from '../repo/paths';

/** A canonical candidate and code paths observed separately from its stated approach. */
export type CollaborationContextCandidate = {
  readonly context: BeanContext;
  readonly observed_paths?: readonly string[];
};

export type CollaborationContextInput = {
  readonly focus: BeanContext;
  readonly observed_paths?: readonly string[];
  readonly candidates: readonly CollaborationContextCandidate[];
  readonly limit?: number;
};

export type CollaborationContextReason =
  | 'direct-request'
  | 'promise-reference'
  | 'promise-consumer'
  | 'shared-path'
  | 'related-intent'
  | 'related-approach'
  | 'related-promise';

/** Text is an excerpt; its source bean/revision is the handle for the exact wording. */
export type CollaborationExcerpt = { readonly text: string; readonly truncated: boolean };

/** A head comparison describes an offer's version, not whether code fulfills its promise. */
export type CollaborationPromiseStatus = {
  readonly reference: PromiseReference;
  readonly current_revision: number | null;
  readonly status: 'current' | 'superseded' | 'unavailable';
};

export type RelatedBeanContext = {
  readonly bean: TaskId;
  readonly revision: number;
  readonly current_cursor: number;
  readonly intent: CollaborationExcerpt;
  readonly approach: CollaborationExcerpt | null;
  readonly shared_paths: readonly string[];
  /** One matching asked path for each candidate path, including folder containment. */
  readonly path_matches: readonly { readonly asked: string; readonly actual: string }[];
  readonly shared_paths_truncated: boolean;
  readonly reasons: readonly CollaborationContextReason[];
  readonly score: number;
  readonly promise_references: readonly PromiseReference[];
  readonly promise_statuses: readonly CollaborationPromiseStatus[];
  readonly request_events: readonly number[];
  readonly context_truncated: boolean;
  readonly expand: { readonly bean: TaskId };
};

/** Omitted/missing handles are explicit: pagination and failed hydration are not relevance. */
export type CollaborationContextSelection = {
  readonly related: readonly RelatedBeanContext[];
  readonly considered: number;
  readonly omitted: number;
  readonly required_omitted: readonly TaskId[];
  readonly required_omitted_count: number;
  readonly missing_required: readonly TaskId[];
  readonly missing_required_count: number;
  readonly expansion_truncated: boolean;
  readonly truncated: boolean;
};

export const DEFAULT_RELATED_BEAN_LIMIT = 8;
export const MAX_RELATED_BEAN_LIMIT = 20;
const MAX_EXPANSION_HANDLES = 32;
const MAX_EXCERPT_CHARS = 500;
const MAX_SHARED_PATHS = 64;
const PATH_WEIGHT = 8;

const STOPWORDS = new Set(
  `a an and are as at be been but by can change changes code could do does for from had has
  have how i if in into is it its make me my not of on or our repo repository should that the
  their them there these they this to update use was we were what when where which while will
  with would you your`.split(/\s+/),
);

type Focus = {
  readonly bean: TaskId;
  readonly words: ReadonlySet<string>;
  readonly paths: ReadonlySet<string>;
  readonly references: readonly PromiseReference[];
  readonly requests: readonly ThreadPost[];
  readonly promises: readonly BeanPromise[];
};

type RankedCandidate = {
  readonly candidate: CollaborationContextCandidate;
  readonly reasons: readonly CollaborationContextReason[];
  readonly score: number;
  readonly required: boolean;
  readonly priority: number;
  readonly sharedPaths: readonly string[];
  readonly pathMatches: readonly { readonly asked: string; readonly actual: string }[];
  readonly references: readonly PromiseReference[];
  readonly promiseStatuses: readonly CollaborationPromiseStatus[];
  readonly requests: readonly number[];
};

/**
 * Compares one bean with a retrieved candidate set, never every pair of contributors.
 * Direct requests and explicit promise references bypass lexical relevance filtering.
 * Authorization and candidate hydration belong to the caller; this function performs no I/O.
 */
export function selectCollaborationContext(
  input: CollaborationContextInput,
): CollaborationContextSelection {
  const focus = describeFocus(input);
  const candidates = uniqueCandidates(input.candidates, focus.bean);
  const ranked = candidates
    .map((candidate) => rankCandidate(candidate, focus))
    .filter((candidate) => candidate.required || candidate.score > 0)
    .toSorted(compareCandidates);
  const selected = ranked.slice(0, relatedLimit(input.limit));
  const requiredOmitted = ranked.slice(selected.length).filter((candidate) => candidate.required);
  const missing = missingRequired(focus, candidates);
  return selection({ input, candidates, ranked, selected, requiredOmitted, missing });
}

function describeFocus(input: CollaborationContextInput): Focus {
  const references = uniqueReferences([
    ...input.focus.reliance,
    ...threadPosts(input.focus).flatMap((post) => post.references),
  ]);
  return {
    bean: input.focus.bean.bean,
    words: wordsOf(contextText(input.focus)),
    paths: new Set(contextPaths(input.focus, input.observed_paths)),
    references,
    promises: input.focus.promises,
    requests: threadPosts(input.focus).filter(
      (post) => post.kind === 'request' && post.bean === input.focus.bean.bean,
    ),
  };
}

function rankCandidate(candidate: CollaborationContextCandidate, focus: Focus): RankedCandidate {
  const context = candidate.context;
  const references = focus.references.filter((reference) => reference.bean === context.bean.bean);
  const consumers = context.reliance.filter((reference) => reference.bean === focus.bean);
  const requests = focus.requests
    .filter((post) => post.author_bean === context.bean.bean)
    .map((post) => post.event_id);
  const pathMatches = matchingPaths(contextPaths(context, candidate.observed_paths), focus.paths);
  const sharedPaths = pathMatches.map((match) => match.actual);
  const lexical = scoreContext(context, focus.words);
  const reasons = candidateReasons({ context, references, requests, sharedPaths, lexical }, focus);
  const exactReferences = uniqueReferences([...references, ...consumers]);
  return {
    candidate,
    references: exactReferences,
    promiseStatuses: exactReferences.map((reference) =>
      promiseStatus(reference, reference.bean === focus.bean ? focus.promises : context.promises),
    ),
    requests,
    sharedPaths,
    pathMatches,
    reasons,
    score: lexical.score + sharedPaths.length * PATH_WEIGHT,
    required: requests.length > 0 || references.length > 0 || consumers.length > 0,
    priority: candidatePriority(requests.length, references.length, consumers.length),
  };
}

function candidatePriority(requests: number, references: number, consumers: number): number {
  if (requests > 0) return 3;
  if (references > 0) return 2;
  return consumers > 0 ? 1 : 0;
}

function matchingPaths(
  paths: readonly string[],
  askedPaths: ReadonlySet<string>,
): readonly { readonly asked: string; readonly actual: string }[] {
  const asked = [...askedPaths];
  return paths.flatMap((actual) => {
    const match = asked.find((path) => touchesPath(actual, path));
    return match === undefined ? [] : [{ asked: match, actual }];
  });
}

function touchesPath(actual: string, asked: string): boolean {
  return (
    actual === asked || actual.startsWith(asFolder(asked)) || asked.startsWith(asFolder(actual))
  );
}

function asFolder(path: string): string {
  return path.endsWith('/') ? path : `${path}/`;
}

function promiseStatus(
  reference: PromiseReference,
  promises: readonly BeanPromise[],
): CollaborationPromiseStatus {
  const revision = promises.find(
    (promise) => promise.bean === reference.bean && promise.id === reference.promise,
  )?.revision;
  if (revision === undefined || revision < reference.revision) {
    return { reference, current_revision: revision ?? null, status: 'unavailable' };
  }
  return {
    reference,
    current_revision: revision,
    status: revision === reference.revision ? 'current' : 'superseded',
  };
}

function scoreContext(context: BeanContext, focus: ReadonlySet<string>) {
  const intent = matchingWords(context.bean.intent, focus);
  const approach = matchingWords(context.bean.approach?.summary ?? '', focus);
  const promises = matchingWords(
    context.promises.map((promise) => `${promise.body} ${promise.conditions}`).join(' '),
    focus,
  );
  return { intent, approach, promises, score: intent * 2 + approach * 3 + promises };
}

function candidateReasons(
  match: {
    readonly context: BeanContext;
    readonly references: readonly PromiseReference[];
    readonly requests: readonly number[];
    readonly sharedPaths: readonly string[];
    readonly lexical: ReturnType<typeof scoreContext>;
  },
  focus: Focus,
): readonly CollaborationContextReason[] {
  const reasons: CollaborationContextReason[] = [];
  if (match.requests.length > 0) reasons.push('direct-request');
  if (match.references.length > 0) reasons.push('promise-reference');
  if (match.context.reliance.some((reference) => reference.bean === focus.bean)) {
    reasons.push('promise-consumer');
  }
  if (match.sharedPaths.length > 0) reasons.push('shared-path');
  if (match.lexical.intent > 0) reasons.push('related-intent');
  if (match.lexical.approach > 0) reasons.push('related-approach');
  if (match.lexical.promises > 0) reasons.push('related-promise');
  return reasons;
}

function selection(input: {
  readonly input: CollaborationContextInput;
  readonly candidates: readonly CollaborationContextCandidate[];
  readonly ranked: readonly RankedCandidate[];
  readonly selected: readonly RankedCandidate[];
  readonly requiredOmitted: readonly RankedCandidate[];
  readonly missing: readonly TaskId[];
}): CollaborationContextSelection {
  const omitted = input.ranked.length - input.selected.length;
  return {
    related: input.selected.map(summarizeCandidate),
    considered: input.candidates.length,
    omitted,
    required_omitted: input.requiredOmitted
      .slice(0, MAX_EXPANSION_HANDLES)
      .map((entry) => entry.candidate.context.bean.bean),
    required_omitted_count: input.requiredOmitted.length,
    missing_required: input.missing.slice(0, MAX_EXPANSION_HANDLES),
    missing_required_count: input.missing.length,
    expansion_truncated:
      input.requiredOmitted.length > MAX_EXPANSION_HANDLES ||
      input.missing.length > MAX_EXPANSION_HANDLES,
    truncated:
      omitted > 0 ||
      input.missing.length > 0 ||
      input.input.focus.truncated ||
      input.selected.some((candidate) => candidate.candidate.context.truncated),
  };
}

function summarizeCandidate(ranked: RankedCandidate): RelatedBeanContext {
  const context = ranked.candidate.context;
  const approach = context.bean.approach;
  return {
    bean: context.bean.bean,
    revision: context.bean.revision,
    current_cursor: context.current_cursor,
    intent: excerpt(context.bean.intent),
    approach: approach === null ? null : excerpt(approach.summary),
    shared_paths: ranked.sharedPaths.slice(0, MAX_SHARED_PATHS),
    path_matches: ranked.pathMatches.slice(0, MAX_SHARED_PATHS),
    shared_paths_truncated: ranked.sharedPaths.length > MAX_SHARED_PATHS,
    reasons: ranked.reasons,
    score: ranked.score,
    promise_references: ranked.references,
    promise_statuses: ranked.promiseStatuses,
    request_events: ranked.requests,
    context_truncated: context.truncated,
    expand: { bean: context.bean.bean },
  };
}

function missingRequired(
  focus: Focus,
  candidates: readonly CollaborationContextCandidate[],
): readonly TaskId[] {
  const present = new Set([
    focus.bean,
    ...candidates.map((candidate) => candidate.context.bean.bean),
  ]);
  const required = [
    ...focus.requests.map((post) => post.author_bean),
    ...focus.references.map((reference) => reference.bean),
  ];
  return [...new Set(required)].filter((bean) => !present.has(bean)).toSorted(compareText);
}

function uniqueCandidates(
  candidates: readonly CollaborationContextCandidate[],
  ownBean: TaskId,
): readonly CollaborationContextCandidate[] {
  const unique = new Map<TaskId, CollaborationContextCandidate>();
  for (const candidate of candidates) {
    const bean = candidate.context.bean.bean;
    if (bean === ownBean) continue;
    const previous = unique.get(bean);
    if (
      previous === undefined ||
      candidate.context.current_cursor > previous.context.current_cursor
    ) {
      unique.set(bean, candidate);
    }
  }
  return [...unique.values()];
}

function uniqueReferences(references: readonly PromiseReference[]): readonly PromiseReference[] {
  const unique = new Map<string, PromiseReference>();
  for (const reference of references) {
    const key = `${reference.bean}/${reference.promise}@${reference.revision}`;
    unique.set(key, {
      bean: reference.bean,
      promise: reference.promise,
      revision: reference.revision,
    });
  }
  return [...unique.values()];
}

function contextText(context: BeanContext): string {
  return [
    context.bean.intent,
    context.bean.approach?.summary ?? '',
    ...context.promises.map((promise) => `${promise.body} ${promise.conditions}`),
  ].join(' ');
}

function contextPaths(context: BeanContext, observed: readonly string[] = []): readonly string[] {
  return [
    ...new Set([
      ...observed,
      ...(context.bean.approach?.paths ?? []),
      ...context.promises.flatMap((promise) => promise.paths),
    ]),
  ].toSorted(compareText);
}

function threadPosts(context: BeanContext): readonly ThreadPost[] {
  return context.history.flatMap((event) => (event.kind === 'thread.posted' ? [event.post] : []));
}

function wordsOf(text: string): ReadonlySet<string> {
  const separated = text.replace(/(?<=[a-z0-9])(?=[A-Z])/g, ' ');
  return new Set(
    [...separated.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)]
      .map((match) => match[0])
      .filter((word) => word.length > 1 && !STOPWORDS.has(word)),
  );
}

function matchingWords(text: string, focus: ReadonlySet<string>): number {
  return [...wordsOf(text)].filter((word) => focus.has(word)).length;
}

function compareCandidates(left: RankedCandidate, right: RankedCandidate): number {
  return (
    right.priority - left.priority ||
    right.score - left.score ||
    compareText(left.candidate.context.bean.bean, right.candidate.context.bean.bean)
  );
}

function relatedLimit(limit: number = DEFAULT_RELATED_BEAN_LIMIT): number {
  return Number.isFinite(limit)
    ? Math.max(1, Math.min(MAX_RELATED_BEAN_LIMIT, Math.floor(limit)))
    : DEFAULT_RELATED_BEAN_LIMIT;
}

function excerpt(text: string): CollaborationExcerpt {
  const segments = new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text);
  let end = 0;
  for (const segment of segments) {
    const next = segment.index + segment.segment.length;
    if (next > MAX_EXCERPT_CHARS) break;
    end = next;
  }
  return { text: text.slice(0, end), truncated: end < text.length };
}
