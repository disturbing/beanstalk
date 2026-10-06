import {
  BeanContext,
  BeanInboxPage,
  BeanPromise,
  BeanReliance,
  CollaborationEvent,
} from '@beanstalk/shared-race/collaboration';
import type {
  BeanContextInput,
  BeanInboxAckResult,
  BeanInboxAckInput,
  BeanInboxReadInput,
  ContributorTokenClaims,
} from '@beanstalk/shared-race/collaboration';
import type { RpcResult } from '@beanstalk/shared-race/rpc';

import type { CollaborationStorage } from './store';
import {
  currentCursor,
  failure,
  readBean,
  readEvent,
  readJsonRows,
  readPromise,
  unreadCount,
} from './store';

/** Incremental history never removes current state or the exact promises it relies upon. */
export function readBeanContext(sql: SqlStorage, input: BeanContextInput): RpcResult<BeanContext> {
  const bean = readBean(sql, input.bean);
  if (bean === null) return failure('not_found', 404, 'bean does not exist');
  const limit = input.limit ?? 50;
  const cursor = currentCursor(sql);
  const since = input.since ?? 0;
  if (since > cursor)
    return failure('invalid_request', 400, 'cursor is ahead of collaboration history');
  const history = readHistory(sql, { bean: input.bean, since, limit });
  const agreements = readAgreements(sql, input.bean);
  const truncated = history.length > limit;
  const bounded = history.slice(0, limit);
  return {
    ok: true,
    value: BeanContext.parse({
      bean,
      ...agreements,
      history: bounded,
      next_cursor: truncated ? (bounded.at(-1)?.event_id ?? since) : cursor,
      current_cursor: cursor,
      truncated,
    }),
  };
}

/** Inbox belongs to the bean, so a replacement harness recovers addressed conversations. */
export function readBeanInbox(
  sql: SqlStorage,
  claims: ContributorTokenClaims,
  input: BeanInboxReadInput,
): RpcResult<BeanInboxPage> {
  const after = input.after_cursor ?? 0;
  const cursor = currentCursor(sql);
  if (after > cursor)
    return failure('invalid_request', 400, 'cursor is ahead of collaboration history');
  const limit = input.limit ?? 50;
  const rows = sql
    .exec<{ event_id: number; acknowledged: number }>(
      input.state === 'unread'
        ? 'SELECT event_id, acknowledged FROM collaboration_inbox WHERE bean = ? AND acknowledged = 0 AND event_id > ? ORDER BY event_id LIMIT ?'
        : 'SELECT event_id, acknowledged FROM collaboration_inbox WHERE bean = ? AND event_id > ? ORDER BY event_id LIMIT ?',
      claims.bean,
      after,
      limit + 1,
    )
    .toArray();
  const truncated = rows.length > limit;
  const bounded = rows.slice(0, limit);
  return {
    ok: true,
    value: BeanInboxPage.parse({
      bean: claims.bean,
      events: bounded.map((row) => ({
        event: readEvent(sql, row.event_id),
        acknowledged: row.acknowledged === 1,
      })),
      next_cursor: truncated ? (bounded.at(-1)?.event_id ?? after) : cursor,
      current_cursor: cursor,
      unread: unreadCount(sql, claims.bean),
      truncated,
    }),
  };
}

/** Acknowledgement only marks receipt; it never creates a promise agreement or reliance. */
export function acknowledgeBeanInbox(
  storage: CollaborationStorage,
  claims: ContributorTokenClaims,
  input: BeanInboxAckInput,
): RpcResult<BeanInboxAckResult> {
  return storage.transactionSync(() => {
    const events = [...new Set(input.event_ids)];
    for (const event of events) {
      const found = storage.sql
        .exec<{ event_id: number }>(
          'SELECT event_id FROM collaboration_inbox WHERE bean = ? AND event_id = ?',
          claims.bean,
          event,
        )
        .toArray()[0];
      if (found === undefined)
        return failure('not_found', 404, 'event is not in the contributor bean inbox');
    }
    for (const event of events)
      storage.sql.exec(
        'UPDATE collaboration_inbox SET acknowledged = 1 WHERE bean = ? AND event_id = ?',
        claims.bean,
        event,
      );
    return {
      ok: true,
      value: { acknowledged: events, unread: unreadCount(storage.sql, claims.bean) },
    };
  });
}

function readHistory(
  sql: SqlStorage,
  input: { bean: string; since: number; limit: number },
): CollaborationEvent[] {
  return readJsonRows(
    sql,
    `SELECT body FROM collaboration_events WHERE id IN (
    SELECT id FROM collaboration_events WHERE bean = ? AND id > ?
    UNION SELECT id FROM collaboration_events WHERE author_bean = ? AND id > ?
    UNION SELECT p.id FROM collaboration_posts p JOIN collaboration_participants m ON p.thread = m.thread
      WHERE m.bean = ? AND p.id > ?
    UNION SELECT event_id FROM collaboration_inbox WHERE bean = ? AND event_id > ?
  ) ORDER BY id LIMIT ?`,
    [
      input.bean,
      input.since,
      input.bean,
      input.since,
      input.bean,
      input.since,
      input.bean,
      input.since,
      input.limit + 1,
    ],
    CollaborationEvent,
  );
}

function readAgreements(
  sql: SqlStorage,
  bean: string,
): Pick<BeanContext, 'promises' | 'reliance' | 'referenced_promises'> {
  const reliance = readJsonRows(
    sql,
    'SELECT body FROM collaboration_reliance WHERE owner = ? ORDER BY bean, promise',
    [bean],
    BeanReliance,
  );
  const referenced = reliance.map((reference) => readPromise(sql, reference));
  if (referenced.some((promise) => promise === null))
    throw new Error('a relied-upon promise is missing');
  const promises = readJsonRows(
    sql,
    `SELECT p.body FROM collaboration_promises p JOIN collaboration_promise_heads h
    ON p.bean = h.bean AND p.promise = h.promise AND p.revision = h.revision WHERE p.bean = ? ORDER BY p.promise`,
    [bean],
    BeanPromise,
  );
  return {
    reliance,
    promises,
    referenced_promises: referenced.filter((promise) => promise !== null),
  };
}
