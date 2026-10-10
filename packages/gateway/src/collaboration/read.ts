import {
  BeanPeerSummary,
  BeanPromise,
  BeanReliance,
  CollaborationEvent,
} from '@gitstalk/shared-race/collaboration';
import type {
  BeanContext,
  BeanContextInput,
  BeanInboxPage,
  BeanInboxAckResult,
  BeanInboxAckInput,
  BeanInboxReadInput,
  ContributorTokenClaims,
} from '@gitstalk/shared-race/collaboration';
import type { RpcResult } from '@gitstalk/shared-race/rpc';

import type { CollaborationStorage } from './store';
import { currentCursor, failure, readBean, readJsonRows, readPromise, unreadCount } from './store';

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
    value: {
      bean,
      ...agreements,
      history: bounded,
      next_cursor: truncated ? (bounded.at(-1)?.event_id ?? since) : cursor,
      current_cursor: cursor,
      truncated,
    },
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
  const unreadOnly = input.state === 'unread' ? 'AND i.acknowledged = 0' : '';
  const rows = sql
    .exec<{ body: string; acknowledged: number }>(
      `SELECT e.body, i.acknowledged FROM collaboration_inbox i
    JOIN collaboration_events e ON e.id = i.event_id
    WHERE i.bean = ? AND i.event_id > ? ${unreadOnly} ORDER BY i.event_id LIMIT ?`,
      claims.bean,
      after,
      limit + 1,
    )
    .toArray();
  const truncated = rows.length > limit;
  const events = rows.slice(0, limit).map((row) => ({
    event: CollaborationEvent.parse(JSON.parse(row.body)),
    acknowledged: row.acknowledged === 1,
  }));
  return {
    ok: true,
    value: {
      bean: claims.bean,
      events,
      next_cursor: truncated ? (events.at(-1)?.event.event_id ?? after) : cursor,
      current_cursor: cursor,
      unread: unreadCount(sql, claims.bean),
      truncated,
    },
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

const EXCERPT_CHARS = 500;

type SummaryRow = {
  bean: string;
  revision: number;
  updated_at: string | null;
  intent: string;
  intent_length: number;
  approach_summary: string | null;
  approach_length: number | null;
  paths: string | null;
};

/**
 * Excerpt-only peer summaries in three bounded queries: no history and no whole records.
 * Beans that do not exist are omitted; the caller sees them as missing.
 */
export function readBeanSummaries(
  sql: SqlStorage,
  beans: readonly string[],
): RpcResult<BeanPeerSummary[]> {
  const unique = [...new Set(beans)];
  if (unique.length === 0) return { ok: true, value: [] };
  const marks = unique.map(() => '?').join(',');
  const rows = sql
    .exec<SummaryRow>(
      `SELECT bean, json_extract(body, '$.revision') AS revision,
    json_extract(body, '$.updated_at') AS updated_at,
    substr(json_extract(body, '$.intent'), 1, ${EXCERPT_CHARS}) AS intent,
    length(json_extract(body, '$.intent')) AS intent_length,
    substr(json_extract(body, '$.approach.summary'), 1, ${EXCERPT_CHARS}) AS approach_summary,
    length(json_extract(body, '$.approach.summary')) AS approach_length,
    json_extract(body, '$.approach.paths') AS paths
    FROM collaboration_beans WHERE bean IN (${marks})`,
      ...unique,
    )
    .toArray();
  const promises = summaryPromises(sql, unique);
  const reliance = summaryReliance(sql, unique);
  const cursor = currentCursor(sql);
  const summaries = rows.map((row) =>
    BeanPeerSummary.parse({
      bean: row.bean,
      revision: row.revision,
      updated_at: row.updated_at,
      intent: row.intent,
      intent_truncated: row.intent_length > EXCERPT_CHARS,
      paths: row.paths === null ? [] : JSON.parse(row.paths),
      approach_summary: row.approach_summary,
      approach_summary_truncated: (row.approach_length ?? 0) > EXCERPT_CHARS,
      promises: promises.get(row.bean) ?? [],
      reliance: reliance.get(row.bean) ?? [],
      current_cursor: cursor,
    }),
  );
  return { ok: true, value: summaries.toSorted((a, b) => a.bean.localeCompare(b.bean)) };
}

function summaryPromises(sql: SqlStorage, beans: readonly string[]) {
  const marks = beans.map(() => '?').join(',');
  const rows = sql
    .exec<{ bean: string; body: string }>(
      `SELECT p.bean, p.body FROM collaboration_promises p JOIN collaboration_promise_heads h
    ON p.bean = h.bean AND p.promise = h.promise AND p.revision = h.revision
    WHERE p.bean IN (${marks}) ORDER BY p.bean, p.promise`,
      ...beans,
    )
    .toArray();
  const byBean = new Map<string, unknown[]>();
  for (const row of rows) {
    const promise = BeanPromise.parse(JSON.parse(row.body));
    const entry = {
      id: promise.id,
      revision: promise.revision,
      body: promise.body.slice(0, EXCERPT_CHARS),
      conditions: promise.conditions.slice(0, EXCERPT_CHARS),
      paths: promise.paths,
    };
    byBean.set(row.bean, [...(byBean.get(row.bean) ?? []), entry]);
  }
  return byBean;
}

function summaryReliance(sql: SqlStorage, beans: readonly string[]) {
  const marks = beans.map(() => '?').join(',');
  const rows = sql
    .exec<{ owner: string; bean: string; promise: string; revision: number }>(
      `SELECT owner, bean, promise, revision FROM collaboration_reliance
    WHERE owner IN (${marks}) ORDER BY owner, bean, promise`,
      ...beans,
    )
    .toArray();
  const byOwner = new Map<string, unknown[]>();
  for (const row of rows) {
    const entry = { bean: row.bean, promise: row.promise, revision: row.revision };
    byOwner.set(row.owner, [...(byOwner.get(row.owner) ?? []), entry]);
  }
  return byOwner;
}
