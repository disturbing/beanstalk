/** Canonical, transport-neutral records for independently operated bean contributors. */
import { z } from 'zod';

import { RunId, TaskId } from './ids';
import { isSafeRepoPath } from './task';

const Revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const Cursor = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const Actor = z.string().trim().min(1).max(32).brand<'CollaborationActor'>();
const RecordId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
const Path = z.string().refine(isSafeRepoPath, 'must be a relative repository path');
const Paths = z.array(Path).max(64);
const IdempotencyKey = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);

/** Signed contributor capabilities identify a stable owning bean, independently of slots. */
export const ContributorTokenClaims = z.strictObject({
  scope: z.literal('contributor'),
  run: RunId,
  bean: TaskId,
  actor: Actor,
  expires_at: z.iso.datetime(),
});
export type ContributorTokenClaims = z.infer<typeof ContributorTokenClaims>;

/** The identity of a promise, used when explicitly ending a reliance. */
export const PromiseKey = z.strictObject({ bean: TaskId, promise: RecordId });
export type PromiseKey = z.infer<typeof PromiseKey>;

/** An exact version of a promise offered by a bean. */
export const PromiseReference = z.strictObject({
  bean: TaskId,
  promise: RecordId,
  revision: Revision,
});
export type PromiseReference = z.infer<typeof PromiseReference>;

/** Optional contributor-authored description of how it intends to make its change. */
export const BeanApproach = z.strictObject({
  summary: z.string().trim().min(1).max(4000),
  paths: Paths,
});
export type BeanApproach = z.infer<typeof BeanApproach>;

/** A promise is an offer, never evidence that an implementation already satisfies it. */
export const PromiseOfferInput = z.strictObject({
  id: RecordId,
  body: z.string().trim().min(1).max(4000),
  conditions: z.string().max(2000),
  paths: Paths,
});
export type PromiseOfferInput = z.infer<typeof PromiseOfferInput>;

export const BeanChanges = z
  .strictObject({
    intent: z.string().trim().min(1).max(10_000).optional(),
    approach: BeanApproach.optional(),
    promises: z.array(PromiseOfferInput).min(1).max(16).optional(),
    reliance: z.array(PromiseReference).min(1).max(32).optional(),
    remove_reliance: z.array(PromiseKey).min(1).max(32).optional(),
  })
  .refine((changes) => Object.keys(changes).length > 0, 'provide at least one change');
export type BeanChanges = z.infer<typeof BeanChanges>;

export const BeanUpdateInput = z.strictObject({
  bean: TaskId,
  expected_revision: Cursor,
  changes: BeanChanges,
  idempotency_key: IdempotencyKey,
});
export type BeanUpdateInput = z.infer<typeof BeanUpdateInput>;

export const ThreadKind = z.enum([
  'note',
  'request',
  'reply',
  'counterproposal',
  'accept',
  'decline',
]);
export const BeanThreadPostInput = z
  .strictObject({
    bean: TaskId,
    thread: RecordId.optional(),
    kind: ThreadKind,
    body: z.string().trim().min(1).max(8000),
    references: z.array(PromiseReference).max(16),
    reply_to: Revision.optional(),
    idempotency_key: IdempotencyKey,
  })
  .superRefine((post, context) => {
    if (
      ['reply', 'counterproposal', 'accept', 'decline'].includes(post.kind) &&
      (post.thread === undefined || post.reply_to === undefined)
    ) {
      context.addIssue({ code: 'custom', message: 'responses require thread and reply_to' });
    }
    if (post.reply_to !== undefined && post.thread === undefined) {
      context.addIssue({ code: 'custom', message: 'reply_to requires an existing thread' });
    }
    if (post.kind === 'accept' && post.references.length !== 1) {
      context.addIssue({
        code: 'custom',
        message: 'acceptance requires one exact promise reference',
      });
    }
  });
export type BeanThreadPostInput = z.infer<typeof BeanThreadPostInput>;

export const BeanContextInput = z.strictObject({
  bean: TaskId,
  since: Cursor.optional(),
  limit: z.number().int().min(1).max(100).optional(),
});
export type BeanContextInput = z.infer<typeof BeanContextInput>;

/** Discover related pending contributions from published metadata before diffs exist. */
export const BeanDiscoverInput = z.strictObject({
  bean: TaskId,
  paths: z.array(Path).max(16).optional(),
  query: z.string().trim().min(1).max(500).optional(),
  limit: z.number().int().min(1).max(32).optional(),
});
export type BeanDiscoverInput = z.infer<typeof BeanDiscoverInput>;

export const BeanInboxReadInput = z.strictObject({
  after_cursor: Cursor.optional(),
  state: z.enum(['all', 'unread']).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});
export type BeanInboxReadInput = z.infer<typeof BeanInboxReadInput>;

export const BeanInboxAckInput = z.strictObject({ event_ids: z.array(Revision).min(1).max(100) });
export type BeanInboxAckInput = z.infer<typeof BeanInboxAckInput>;

export const CollaborationSource = z.strictObject({
  bean: TaskId,
  revision: Cursor,
  event_id: Revision,
});
export type CollaborationSource = z.infer<typeof CollaborationSource>;
export const BeanPromise = PromiseOfferInput.extend({
  bean: TaskId,
  revision: Revision,
  actor: Actor,
  offered_at: z.iso.datetime(),
  source: CollaborationSource,
});
export type BeanPromise = z.infer<typeof BeanPromise>;

export const BeanReliance = PromiseReference.extend({
  actor: Actor,
  recorded_at: z.iso.datetime(),
  accepted_event: Revision.nullable(),
  source: CollaborationSource,
});
export type BeanReliance = z.infer<typeof BeanReliance>;

export const BeanRecord = z.strictObject({
  bean: TaskId,
  revision: Cursor,
  intent: z.string().max(100_000),
  approach: BeanApproach.nullable(),
  actor: Actor.nullable(),
  updated_at: z.iso.datetime().nullable(),
});
export type BeanRecord = z.infer<typeof BeanRecord>;

export const BeanDiscoverPage = z.strictObject({
  beans: z.array(BeanRecord).max(32),
  truncated: z.boolean(),
});
export type BeanDiscoverPage = z.infer<typeof BeanDiscoverPage>;

export const ThreadPost = z.strictObject({
  event_id: Revision,
  bean: TaskId,
  thread: RecordId,
  author_bean: TaskId,
  actor: Actor,
  kind: ThreadKind,
  body: z.string(),
  references: z.array(PromiseReference).max(16),
  reply_to: Revision.nullable(),
  created_at: z.iso.datetime(),
});
export type ThreadPost = z.infer<typeof ThreadPost>;

export const CollaborationEvent = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('bean.updated'),
    event_id: Revision,
    bean: TaskId,
    author_bean: TaskId,
    actor: Actor,
    revision: Revision,
    created_at: z.iso.datetime(),
    changes: BeanChanges,
  }),
  z.strictObject({ kind: z.literal('thread.posted'), event_id: Revision, post: ThreadPost }),
]);
export type CollaborationEvent = z.infer<typeof CollaborationEvent>;

export const BeanContext = z.strictObject({
  bean: BeanRecord,
  promises: z.array(BeanPromise).max(64),
  reliance: z.array(BeanReliance).max(128),
  referenced_promises: z.array(BeanPromise).max(128),
  history: z.array(CollaborationEvent).max(100),
  next_cursor: Cursor,
  current_cursor: Cursor,
  truncated: z.boolean(),
});
export type BeanContext = z.infer<typeof BeanContext>;

export const BeanUpdateResult = z.strictObject({ bean: BeanRecord, event_id: Revision });
export type BeanUpdateResult = z.infer<typeof BeanUpdateResult>;
export const BeanThreadPostResult = z.strictObject({
  post: ThreadPost,
  reliance: BeanReliance.nullable(),
});
export type BeanThreadPostResult = z.infer<typeof BeanThreadPostResult>;
export const BeanInboxEvent = z.strictObject({
  event: CollaborationEvent,
  acknowledged: z.boolean(),
});
export const BeanInboxPage = z.strictObject({
  bean: TaskId,
  events: z.array(BeanInboxEvent).max(100),
  next_cursor: Cursor,
  current_cursor: Cursor,
  unread: Cursor,
  truncated: z.boolean(),
});
export type BeanInboxPage = z.infer<typeof BeanInboxPage>;
export const BeanInboxAckResult = z.strictObject({
  acknowledged: z.array(Revision).max(100),
  unread: Cursor,
});
export type BeanInboxAckResult = z.infer<typeof BeanInboxAckResult>;
