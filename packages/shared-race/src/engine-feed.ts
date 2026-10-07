/**
 * What happened in repositories' engines, for a person's Home (`docs/claude-opus/20` §4): the
 * engine events a person cares about (beans pushed, red checks, conflicts, landings,
 * validations, decisions, parked and fallen-off beans), newest first, with who pushed each
 * bean. One call answers for many engines, so a Home with many repositories makes one call.
 */
import type { RpcResult, TaskCounts } from './rpc';

/** The kinds of line the feed shows. */
export type EngineFeedKind =
  | 'pushed'
  | 'red'
  | 'conflict'
  | 'landed'
  | 'validated'
  | 'decision'
  | 'decided'
  | 'parked'
  | 'dropped';

export type EngineFeedItem = {
  /** The event's sequence number in its engine's log. */
  readonly seq: number;
  /** ISO 8601, the event's wall clock. */
  readonly at: string;
  readonly kind: EngineFeedKind;
  /** The bean it is about (the winner of a decision), or null. */
  readonly bean: string | null;
  /** The bean's title (its commit subject), when the bean was pushed. */
  readonly title: string | null;
  /** Who pushed the bean (a handle), when it was pushed. */
  readonly actor: string | null;
  /**
   * A short fact for the line: failing tests or conflicted files (comma separated), the
   * card id of a decision, the commit a landing made, or a reason.
   */
  readonly detail: string;
};

export type EngineFeed = {
  readonly engine_id: string;
  /** The engine's beans by status (the `runView` counts); empty for an engine that is not open. */
  readonly tasks: Partial<TaskCounts>;
  /** Newest first, at most the asked limit. */
  readonly items: readonly EngineFeedItem[];
};

/** At most this many engines per call. */
export const MAX_FEED_ENGINES = 50;
/** At most this many items per engine. */
export const MAX_FEED_ITEMS = 50;

export type EngineFeedRpc = {
  /**
   * The recent feed of each engine, in the order asked. An engine that is missing or not
   * readable comes back with no counts and no items, never as a failure of the whole call.
   * The caller (the web app) checks that the viewer may read each repository first.
   */
  engineFeeds(
    engineIds: readonly string[],
    limit: number,
  ): Promise<RpcResult<readonly EngineFeed[]>>;
};
