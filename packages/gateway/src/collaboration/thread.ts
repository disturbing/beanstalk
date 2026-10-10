import { BeanThreadPostResult } from '@gitstalk/shared-race/collaboration';
import type {
  BeanRecord,
  BeanReliance,
  BeanThreadPostInput,
  ContributorTokenClaims,
  ThreadPost,
} from '@gitstalk/shared-race/collaboration';
import type { RpcResult } from '@gitstalk/shared-race/rpc';

import type { CollaborationStorage } from './store';
import {
  appendEvent,
  failure,
  idempotent,
  nextEventId,
  notifyBeans,
  readBean,
  readPost,
  readPromise,
  saveBean,
  saveReliance,
} from './store';
import { validateReferences } from './update';

type ThreadTarget = { thread: string; parent: ThreadPost | null };

/** Any contributor can address an existing bean without assuming control of its work. */
export function postBeanThread(
  storage: CollaborationStorage,
  claims: ContributorTokenClaims,
  input: BeanThreadPostInput,
): RpcResult<BeanThreadPostResult> {
  return idempotent(
    storage,
    {
      bean: claims.bean,
      actor: claims.actor,
      key: input.idempotency_key,
      payload: { method: 'bean_thread_post', input },
      schema: BeanThreadPostResult,
    },
    () => commitPost(storage.sql, claims, input),
  );
}

function commitPost(
  sql: SqlStorage,
  claims: ContributorTokenClaims,
  input: BeanThreadPostInput,
): RpcResult<BeanThreadPostResult> {
  const own = readBean(sql, claims.bean);
  if (own === null || readBean(sql, input.bean) === null)
    return failure('not_found', 404, 'bean does not exist');
  const event = nextEventId(sql);
  const target = resolveThread(sql, input, event);
  if (!target.ok) return target;
  const valid = validatePost(sql, { claims, input, parent: target.value.parent });
  if (!valid.ok) return valid;
  const post: ThreadPost = {
    event_id: event,
    bean: input.bean,
    author_bean: claims.bean,
    actor: claims.actor,
    thread: target.value.thread,
    kind: input.kind,
    body: input.body,
    references: input.references,
    reply_to: input.reply_to ?? null,
    created_at: new Date().toISOString(),
  };
  const reliance = input.kind === 'accept' ? acceptPromise(sql, { own, claims, post }) : null;
  persistPost(sql, claims, post);
  return { ok: true, value: { post, reliance } };
}

function resolveThread(
  sql: SqlStorage,
  input: BeanThreadPostInput,
  event: number,
): RpcResult<ThreadTarget> {
  if (input.thread === undefined)
    return { ok: true, value: { thread: `thread-${event}`, parent: null } };
  const first = sql
    .exec<{ id: number; bean: string }>(
      'SELECT id, bean FROM collaboration_posts WHERE thread = ? ORDER BY id LIMIT 1',
      input.thread,
    )
    .toArray()[0];
  if (first === undefined) return failure('not_found', 404, 'thread does not exist');
  if (first.bean !== input.bean)
    return failure('invalid_request', 400, 'thread belongs to another target bean');
  const parent = input.reply_to === undefined ? null : readPost(sql, input.reply_to);
  if (input.reply_to !== undefined && (parent === null || parent.thread !== input.thread)) {
    return failure('invalid_request', 400, 'reply_to must identify a post in the same thread');
  }
  return { ok: true, value: { thread: input.thread, parent } };
}

function validatePost(
  sql: SqlStorage,
  context: {
    claims: ContributorTokenClaims;
    input: BeanThreadPostInput;
    parent: ThreadPost | null;
  },
): RpcResult<{ valid: true }> {
  for (const reference of context.input.references) {
    if (readPromise(sql, reference) === null)
      return failure('not_found', 404, 'referenced promise revision does not exist');
  }
  if (context.input.kind !== 'accept') return { ok: true, value: { valid: true } };
  const reference = context.input.references[0];
  const parent = context.parent;
  if (
    reference === undefined ||
    parent === null ||
    parent.author_bean === context.claims.bean ||
    reference.bean !== parent.author_bean
  ) {
    return failure(
      'invalid_request',
      400,
      'acceptance must reply to a different bean offering its own promise',
    );
  }
  if (
    !parent.references.some(
      (offered) =>
        offered.bean === reference.bean &&
        offered.promise === reference.promise &&
        offered.revision === reference.revision,
    )
  ) {
    return failure(
      'invalid_request',
      400,
      'acceptance must reference the exact promise in the replied-to post',
    );
  }
  const current = validateReferences(sql, [reference]);
  if (!current.ok) return current;
  const count = sql
    .exec<{ count: number }>(
      'SELECT COUNT(*) AS count FROM collaboration_reliance WHERE owner = ? AND NOT (bean = ? AND promise = ?)',
      context.claims.bean,
      reference.bean,
      reference.promise,
    )
    .one().count;
  return count >= 128
    ? failure('invalid_state', 409, 'bean has reached its reliance limit')
    : { ok: true, value: { valid: true } };
}

function acceptPromise(
  sql: SqlStorage,
  context: {
    own: BeanRecord;
    claims: ContributorTokenClaims;
    post: ThreadPost;
  },
): BeanReliance {
  const reference = context.post.references[0];
  if (reference === undefined) throw new Error('validated acceptance has no promise');
  const updated = {
    ...context.own,
    revision: context.own.revision + 1,
    actor: context.claims.actor,
    updated_at: context.post.created_at,
  };
  const reliance: BeanReliance = {
    ...reference,
    actor: context.claims.actor,
    recorded_at: context.post.created_at,
    accepted_event: context.post.event_id,
    source: {
      bean: context.claims.bean,
      revision: updated.revision,
      event_id: context.post.event_id,
    },
  };
  saveBean(sql, updated);
  saveReliance(sql, context.claims.bean, reliance);
  return reliance;
}

function persistPost(sql: SqlStorage, claims: ContributorTokenClaims, post: ThreadPost): void {
  appendEvent(sql, { kind: 'thread.posted', event_id: post.event_id, post });
  sql.exec(
    'INSERT INTO collaboration_posts (id, thread, bean, body) VALUES (?, ?, ?, ?)',
    post.event_id,
    post.thread,
    post.bean,
    JSON.stringify(post),
  );
  for (const participant of new Set([claims.bean, post.bean])) {
    sql.exec(
      'INSERT OR IGNORE INTO collaboration_participants (thread, bean) VALUES (?, ?)',
      post.thread,
      participant,
    );
  }
  const recipients = sql
    .exec<{ bean: string }>(
      'SELECT bean FROM collaboration_participants WHERE thread = ?',
      post.thread,
    )
    .toArray()
    .map((row) => row.bean)
    .filter((bean) => bean !== claims.bean);
  notifyBeans(sql, post.event_id, recipients);
}
