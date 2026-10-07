/**
 * Home's "Recent activity": the engines' feeds (beans pushed, reds, landings, validations,
 * decisions) merged with the registry's own lines (created, renamed …), newest first. The
 * feeds come from one `engineFeeds` call for every repository on the page, which also
 * answers each repository's counts, so Home makes no call per repository.
 */
import { z } from 'zod';

import { log } from '../log';
import type { RepositoryActivity, RepositoryRecord } from './registry-client';

const FeedItem = z.object({
  seq: z.number(),
  at: z.string(),
  kind: z.enum([
    'pushed',
    'red',
    'conflict',
    'landed',
    'validated',
    'decision',
    'decided',
    'parked',
    'dropped',
  ]),
  bean: z.string().nullable(),
  title: z.string().nullable(),
  actor: z.string().nullable(),
  detail: z.string(),
});
export type FeedItem = z.infer<typeof FeedItem>;

const Feed = z.object({
  engine_id: z.string(),
  tasks: z.record(z.string(), z.number()),
  items: z.array(FeedItem),
});
export type Feed = z.infer<typeof Feed>;

const FeedsAnswer = z.union([
  z.object({ ok: z.literal(true), value: z.array(Feed) }),
  z.object({ ok: z.literal(false) }),
]);

/** Items asked per engine. */
const ITEMS_PER_ENGINE = 20;

/**
 * Each engine's feed by engine id. A gateway without `engineFeeds`, or a failed call, reads as
 * no feeds: Home then shows the registry's lines and no counts, never an error.
 */
export async function readEngineFeeds(
  binding: object,
  engineIds: readonly string[],
): Promise<ReadonlyMap<string, Feed>> {
  const method: unknown = Reflect.get(binding, 'engineFeeds');
  if (typeof method !== 'function' || engineIds.length === 0) return new Map();
  try {
    const answer = FeedsAnswer.safeParse(
      await Reflect.apply(method, binding, [engineIds, ITEMS_PER_ENGINE]),
    );
    if (!answer.success || !answer.data.ok) return new Map();
    return new Map(answer.data.value.map((feed) => [feed.engine_id, feed]));
  } catch (error: unknown) {
    log.warn('engine feeds unreadable; Home shows registry activity only', { error });
    return new Map();
  }
}

/** One line of Home's activity. */
export type ActivityLine = {
  readonly key: string;
  /** ISO 8601. */
  readonly at: string;
  readonly owner: string;
  readonly repo: string;
  readonly tone: 'good' | 'bad' | 'neutral' | 'decide';
  /** The bean the line is about, linked to its page. */
  readonly bean: string | null;
  /** The sentence after the bean's name (or the whole sentence without one). */
  readonly text: string;
};

/** The newest `limit` lines across the registry and the engines' feeds. */
export function activityLines(input: {
  readonly records: readonly RepositoryRecord[];
  readonly registry: readonly RepositoryActivity[];
  readonly feeds: ReadonlyMap<string, Feed>;
  readonly limit: number;
}): readonly ActivityLine[] {
  const fromRegistry = input.registry.map((line): ActivityLine => ({
    key: `${line.repo_id}:${line.at}:${line.kind}`,
    at: line.at,
    owner: line.owner_handle,
    repo: line.repo_name,
    tone: 'neutral',
    bean: null,
    text: line.text,
  }));
  const fromEngines = input.records.flatMap((record) => {
    const feed = input.feeds.get(record.engine_id);
    return feed === undefined ? [] : latestPerBean(feed.items).map((item) => lineOf(record, item));
  });
  return [...fromRegistry, ...fromEngines]
    .toSorted((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, input.limit);
}

/** Steps a later line already implies: a push that then landed, a landing then validated. */
const SUPERSEDED: ReadonlySet<FeedItem['kind']> = new Set(['pushed', 'landed']);

/** Drops a bean's pushed and landed lines once a later line about it exists (items newest first). */
export function latestPerBean(items: readonly FeedItem[]): readonly FeedItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (item.bean === null) return true;
    const later = seen.has(item.bean);
    seen.add(item.bean);
    return !(later && SUPERSEDED.has(item.kind));
  });
}

function lineOf(record: RepositoryRecord, item: FeedItem): ActivityLine {
  return {
    key: `${record.id}:${item.seq}:${item.kind}:${item.bean ?? ''}`,
    at: item.at,
    owner: record.owner.handle,
    repo: record.name,
    tone: toneOf(item.kind),
    bean: item.kind === 'decision' || item.kind === 'decided' ? null : item.bean,
    text: sentenceOf(item),
  };
}

function toneOf(kind: FeedItem['kind']): ActivityLine['tone'] {
  if (kind === 'validated' || kind === 'landed') return 'good';
  if (kind === 'red' || kind === 'conflict' || kind === 'dropped') return 'bad';
  return kind === 'decision' || kind === 'parked' ? 'decide' : 'neutral';
}

function sentenceOf(item: FeedItem): string {
  const by = item.actor === null ? '' : `, pushed by @${item.actor}`;
  const title = item.title === null ? '' : `: “${item.title}”`;
  switch (item.kind) {
    case 'pushed':
      return `was pushed${title}${by}`;
    case 'red':
      return `went red: ${failingText(item.detail)}`;
    case 'conflict':
      return `conflicted with the sprout in ${item.detail}`;
    case 'landed':
      return `landed on the sprout as ${item.detail}${by}`;
    case 'validated':
      return `reached the stalk${title}${by}`;
    case 'decision':
      return `Decision ${item.detail.replace(':', ' needs a person:')}`;
    case 'decided':
      return `Decided ${item.detail.replace(': by ', ' by ')}`;
    case 'parked':
      return `is parked: ${item.detail}`;
    case 'dropped':
      return `fell off: ${item.detail}`;
    default:
      return item.detail;
  }
}

function failingText(detail: string): string {
  const tests = detail === '' ? [] : detail.split(', ');
  if (tests.length === 0) return 'its pre-land check failed';
  return tests.length === 1 ? `${tests[0]} failed` : `${tests.length} tests failed`;
}
