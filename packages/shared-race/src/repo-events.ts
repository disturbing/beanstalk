/**
 * Repository events (backlog 2.6, `docs/claude-opus/20-repositories.md` §6): what a
 * repository's engine tells the rest of the forge, through the `repo-events` Queue, so the
 * web's lists read D1 indexes instead of asking each engine. The engine's Durable Object
 * publishes them from its own event log (it keeps a cursor, so nothing is lost and a
 * repository that grew before the queue existed catches up); the gateway's consumer writes
 * `beans`, `decisions`, `repo_daily`, `repo_lines` and activity lines. Every message is
 * validated with these schemas before anything is written.
 */
import { z } from 'zod';

import type { RepositoryActivity, Viewer } from './repos';
import type { RpcResult } from './rpc';

/** Shas and ids as the engine writes them; lists are capped so a message stays small. */
const Sha = z.string().min(1).max(64);
const Name = z.string().min(1).max(200);
const Text = z.string().max(500);
const Names = z.array(Name).max(50);

const Base = { seq: z.number().int().min(1), at: z.string().min(1).max(40) };

/** One thing that happened on a repository's lines, as the indexes need it. */
export const RepoEvent = z.discriminatedUnion('kind', [
  /** A bean was pushed (or started) and its pre-land check began. */
  z.object({
    ...Base,
    kind: z.literal('bean.opened'),
    bean: Name,
    title: Text,
    actor: Name.nullable(),
  }),
  /** The bean's checked merge landed on the sprout. */
  z.object({
    ...Base,
    kind: z.literal('bean.landed'),
    bean: Name,
    sha: Sha,
    trunk_idx: z.number().int(),
    files: z.number().int().min(0),
    actor: Name.nullable(),
  }),
  /** The bean went back to its author (a red check or a conflict). */
  z.object({ ...Base, kind: z.literal('bean.rework'), bean: Name, reason: Text }),
  /** The bean left the engine without shipping: dropped, or parked for a person. */
  z.object({
    ...Base,
    kind: z.literal('bean.ended'),
    bean: Name,
    outcome: z.enum(['dropped', 'parked']),
    reason: Text,
  }),
  /** A landed bean was taken off the sprout after a red validation. */
  z.object({
    ...Base,
    kind: z.literal('bean.reverted'),
    bean: Name.nullable(),
    reverted: Sha,
    sha: Sha,
    trunk_idx: z.number().int(),
  }),
  /** The stalk moved to a validated sprout commit, carrying these beans. */
  z.object({
    ...Base,
    kind: z.literal('stalk.promoted'),
    sha: Sha,
    trunk_idx: z.number().int(),
    beans: Names,
  }),
  /** An audit found the stalk red: it went back to the newest commit a full suite passed. */
  z.object({
    ...Base,
    kind: z.literal('stalk.demoted'),
    sha: Sha,
    trunk_idx: z.number().int(),
    beans: Names,
    failing: Names,
  }),
  /** A validation of the sprout went red (a ticket opened). */
  z.object({
    ...Base,
    kind: z.literal('sprout.red'),
    sha: Sha,
    trunk_idx: z.number().int(),
    failing: Names,
  }),
  /** A decision card is waiting for a person. */
  z.object({
    ...Base,
    kind: z.literal('decision.asked'),
    card: Name,
    bean: Name,
    against: Names,
    reason: Text.nullable(),
  }),
  /** A decision card was answered (`by`: `human:<handle>`, a rule, or a timeout). */
  z.object({
    ...Base,
    kind: z.literal('decision.made'),
    card: Name,
    winner: Name,
    loser: Name,
    by: Name,
  }),
]);
export type RepoEvent = z.infer<typeof RepoEvent>;
export type RepoEventKind = RepoEvent['kind'];

/** One queue message: a run of one engine's events, in its order. */
export const RepoEventsMessage = z.object({
  v: z.literal(1),
  engine: z.string().min(1).max(64),
  events: z.array(RepoEvent).min(1).max(100),
});
export type RepoEventsMessage = z.infer<typeof RepoEventsMessage>;

/** Where a bean stands in the index. */
export const BEAN_STATES = [
  'growing',
  'landed',
  'promoted',
  'reverted',
  'dropped',
  'parked',
] as const;
export type BeanState = (typeof BEAN_STATES)[number];

/** A bean as the D1 index holds it. Times are ISO 8601. */
export type IndexedBean = {
  readonly bean: string;
  readonly title: string;
  readonly actor: string | null;
  readonly state: BeanState;
  readonly opened_at: string | null;
  readonly landed_at: string | null;
  readonly landed_sha: string | null;
  readonly promoted_at: string | null;
  /** The stalk commit that first carried it. */
  readonly promoted_sha: string | null;
  readonly reverted_at: string | null;
  readonly reason: string;
  readonly reworks: number;
  readonly updated_at: string;
};

/** The heads of the two lines, as the last events left them. */
export type RepoLines = {
  readonly sprout_sha: string | null;
  readonly sprout_idx: number | null;
  readonly stalk_sha: string | null;
  readonly stalk_idx: number | null;
  readonly updated_at: string;
};

/** One day's counts (UTC), for History and later Insights. */
export type RepoDay = {
  readonly day: string;
  readonly landed: number;
  readonly promoted: number;
  readonly reverted: number;
  readonly red_validations: number;
  readonly reworks: number;
  readonly decisions: number;
};

/** One move of the stalk, with the beans it validated. */
export type StalkPromotion = {
  readonly at: string;
  readonly sha: string;
  readonly kind: 'promoted' | 'demoted';
  readonly beans: readonly IndexedBean[];
  readonly text: string;
};

/**
 * The History tab's validation view (it folded the earlier Stalk tab): what is validated and on
 * the stalk, what is landed and still validating, and each commit's verdicts.
 */
export type RepositoryStalk = {
  readonly lines: RepoLines | null;
  /** Landed on the sprout, waiting for (or in) a validation run. */
  readonly validating: readonly IndexedBean[];
  /** Newest first. */
  readonly promotions: readonly StalkPromotion[];
  /** Taken off the sprout, dropped or parked, newest first. */
  readonly off: readonly IndexedBean[];
  /** In their pre-land checks or with their authors. */
  readonly growing: readonly IndexedBean[];
  /** The last 7 days with anything, newest first. */
  readonly days: readonly RepoDay[];
  /** The repository's own activity (registry and engine), newest first. */
  readonly activity: readonly RepositoryActivity[];
  /** Validation verdicts naming a commit (promoted, demoted, red, reverted), newest first. */
  readonly verdicts: readonly RepositoryActivity[];
};

/** What a repository has grown, for Home's list. */
export type RepositoryGrowth = {
  readonly repo_id: string;
  /** Beans landed or on the stalk, not taken off. */
  readonly landed: number;
  /** Beans in their checks or with their authors. */
  readonly growing: number;
  /** Whether the index has heard from this repository's engine at all. */
  readonly indexed: boolean;
};

/** The index RPC on the gateway's default entrypoint (the web's GATEWAY binding). */
export type RepoIndexRpc = {
  repositoryStalk(repoId: string, viewer: Viewer): Promise<RpcResult<RepositoryStalk>>;
  /** Counts for the repositories among `repoIds` the viewer may read. */
  repositoryGrowth(
    repoIds: readonly string[],
    viewer: Viewer,
  ): Promise<RpcResult<readonly RepositoryGrowth[]>>;
};
