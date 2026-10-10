import type { z } from 'zod';

import {
  BeanRecord,
  BeanPromise,
  CollaborationEvent,
  ThreadPost,
} from '@gitstalk/shared-race/collaboration';
import type { BeanReliance } from '@gitstalk/shared-race/collaboration';
import type { RpcResult } from '@gitstalk/shared-race/rpc';

export type CollaborationStorage = Pick<DurableObjectStorage, 'sql' | 'transactionSync'>;

/** Additive tables keep collaboration metadata separate from engine transitions. */
export function migrateCollaboration(sql: SqlStorage): void {
  sql.exec(COLLABORATION_SCHEMA);
}

/** Seed stable bean identities without claiming work, dispatching agents or editing tasks. */
export function seedCollaboration(
  sql: SqlStorage,
  beans: readonly { id: string; prompt: string }[],
): void {
  const seeded = new Set(
    sql
      .exec<{ bean: string }>('SELECT bean FROM collaboration_beans')
      .toArray()
      .map((row) => row.bean),
  );
  for (const bean of beans) {
    if (seeded.has(bean.id)) continue;
    const record = BeanRecord.parse({
      bean: bean.id,
      intent: bean.prompt,
      revision: 0,
      approach: null,
      actor: null,
      updated_at: null,
    });
    sql.exec(
      'INSERT OR IGNORE INTO collaboration_beans (bean, body) VALUES (?, ?)',
      bean.id,
      JSON.stringify(record),
    );
    indexBean(sql, record);
    seeded.add(bean.id);
  }
}

export function readBean(sql: SqlStorage, bean: string): BeanRecord | null {
  return readJson(sql, 'SELECT body FROM collaboration_beans WHERE bean = ?', [bean], BeanRecord);
}

export function saveBean(sql: SqlStorage, bean: BeanRecord): void {
  sql.exec(
    'UPDATE collaboration_beans SET body = ? WHERE bean = ?',
    JSON.stringify(bean),
    bean.bean,
  );
  indexBean(sql, bean);
}

export function readPromise(
  sql: SqlStorage,
  reference: { bean: string; promise: string; revision: number },
): BeanPromise | null {
  return readJson(
    sql,
    'SELECT body FROM collaboration_promises WHERE bean = ? AND promise = ? AND revision = ?',
    [reference.bean, reference.promise, reference.revision],
    BeanPromise,
  );
}

export function currentPromiseRevision(
  sql: SqlStorage,
  bean: string,
  promise: string,
): number | null {
  return (
    sql
      .exec<{ revision: number }>(
        'SELECT revision FROM collaboration_promise_heads WHERE bean = ? AND promise = ?',
        bean,
        promise,
      )
      .toArray()[0]?.revision ?? null
  );
}

export function savePromise(sql: SqlStorage, promise: BeanPromise): void {
  indexPaths(sql, { bean: promise.bean, source: `promise:${promise.id}`, paths: promise.paths });
  sql.exec(
    'INSERT INTO collaboration_promises (bean, promise, revision, body) VALUES (?, ?, ?, ?)',
    promise.bean,
    promise.id,
    promise.revision,
    JSON.stringify(promise),
  );
  sql.exec(
    'INSERT INTO collaboration_promise_heads (bean, promise, revision) VALUES (?, ?, ?) ON CONFLICT (bean, promise) DO UPDATE SET revision = excluded.revision',
    promise.bean,
    promise.id,
    promise.revision,
  );
}

export function saveReliance(sql: SqlStorage, owner: string, reliance: BeanReliance): void {
  sql.exec(
    'INSERT INTO collaboration_reliance (owner, bean, promise, revision, body) VALUES (?, ?, ?, ?, ?) ON CONFLICT (owner, bean, promise) DO UPDATE SET revision = excluded.revision, body = excluded.body',
    owner,
    reliance.bean,
    reliance.promise,
    reliance.revision,
    JSON.stringify(reliance),
  );
}

export function readPost(sql: SqlStorage, id: number): ThreadPost | null {
  return readJson(sql, 'SELECT body FROM collaboration_posts WHERE id = ?', [id], ThreadPost);
}

export function readEvent(sql: SqlStorage, id: number): CollaborationEvent {
  const event = readJson(
    sql,
    'SELECT body FROM collaboration_events WHERE id = ?',
    [id],
    CollaborationEvent,
  );
  if (event === null) throw new Error(`collaboration event ${id} is missing`);
  return event;
}

export function nextEventId(sql: SqlStorage): number {
  return currentCursor(sql) + 1;
}

export function currentCursor(sql: SqlStorage): number {
  return sql
    .exec<{ cursor: number }>('SELECT COALESCE(MAX(id), 0) AS cursor FROM collaboration_events')
    .one().cursor;
}

export function appendEvent(sql: SqlStorage, event: CollaborationEvent): void {
  const bean = event.kind === 'bean.updated' ? event.bean : event.post.bean;
  const author = event.kind === 'bean.updated' ? event.author_bean : event.post.author_bean;
  sql.exec(
    'INSERT INTO collaboration_events (id, bean, author_bean, body) VALUES (?, ?, ?, ?)',
    event.event_id,
    bean,
    author,
    JSON.stringify(event),
  );
}

export function notifyBeans(sql: SqlStorage, event: number, beans: Iterable<string>): void {
  for (const bean of new Set(beans)) {
    sql.exec(
      'INSERT OR IGNORE INTO collaboration_inbox (bean, event_id) VALUES (?, ?)',
      bean,
      event,
    );
  }
}

export function unreadCount(sql: SqlStorage, bean: string): number {
  return sql
    .exec<{ count: number }>(
      'SELECT COUNT(*) AS count FROM collaboration_inbox WHERE bean = ? AND acknowledged = 0',
      bean,
    )
    .one().count;
}

export function failure(
  code: string,
  status: number,
  message: string,
): { ok: false; error: { code: string; status: number; message: string } } {
  return { ok: false, error: { code, status, message } };
}

/** Stored JSON is checked at the boundary rather than trusted after durable recovery. */
export function readJson<T>(
  sql: SqlStorage,
  query: string,
  bindings: (string | number)[],
  schema: z.ZodType<T>,
): T | null {
  const body = sql.exec<{ body: string }>(query, ...bindings).toArray()[0]?.body;
  return body === undefined ? null : schema.parse(JSON.parse(body));
}

export function readJsonRows<T>(
  sql: SqlStorage,
  query: string,
  bindings: (string | number)[],
  schema: z.ZodType<T>,
): T[] {
  return sql
    .exec<{ body: string }>(query, ...bindings)
    .toArray()
    .map((row) => schema.parse(JSON.parse(row.body)));
}

export function idempotent<T>(
  storage: CollaborationStorage,
  identity: {
    bean: string;
    actor: string;
    key: string;
    payload: unknown;
    schema: z.ZodType<T>;
  },
  mutate: () => RpcResult<T>,
): RpcResult<T> {
  return storage.transactionSync(() => {
    const payload = JSON.stringify(identity.payload);
    const previous = storage.sql
      .exec<{ payload: string; result: string }>(
        'SELECT payload, result FROM collaboration_idempotency WHERE bean = ? AND key = ?',
        identity.bean,
        identity.key,
      )
      .toArray()[0];
    if (previous !== undefined) {
      if (previous.payload !== payload)
        return failure('conflict', 409, 'idempotency key was used with different input');
      return { ok: true, value: identity.schema.parse(JSON.parse(previous.result)) };
    }
    const result = mutate();
    if (result.ok) {
      storage.sql.exec(
        'INSERT INTO collaboration_idempotency (bean, actor, key, payload, result) VALUES (?, ?, ?, ?, ?)',
        identity.bean,
        identity.actor,
        identity.key,
        payload,
        JSON.stringify(result.value),
      );
    }
    return result;
  });
}

const COLLABORATION_SCHEMA = `
    CREATE TABLE IF NOT EXISTS collaboration_beans (bean TEXT PRIMARY KEY, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS collaboration_paths (
      bean TEXT NOT NULL, source TEXT NOT NULL, path TEXT NOT NULL, PRIMARY KEY (bean, source, path)
    );
    CREATE INDEX IF NOT EXISTS collaboration_path_lookup ON collaboration_paths(path, bean);
    CREATE VIRTUAL TABLE IF NOT EXISTS collaboration_search USING fts5(bean UNINDEXED, intent, approach);
    CREATE TABLE IF NOT EXISTS collaboration_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, bean TEXT NOT NULL, author_bean TEXT NOT NULL, body TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS collaboration_events_bean ON collaboration_events(bean, id);
    CREATE INDEX IF NOT EXISTS collaboration_events_author ON collaboration_events(author_bean, id);
    CREATE TABLE IF NOT EXISTS collaboration_promises (
      bean TEXT NOT NULL, promise TEXT NOT NULL, revision INTEGER NOT NULL, body TEXT NOT NULL,
      PRIMARY KEY (bean, promise, revision)
    );
    CREATE TABLE IF NOT EXISTS collaboration_promise_heads (
      bean TEXT NOT NULL, promise TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY (bean, promise)
    );
    CREATE TABLE IF NOT EXISTS collaboration_reliance (
      owner TEXT NOT NULL, bean TEXT NOT NULL, promise TEXT NOT NULL, revision INTEGER NOT NULL,
      body TEXT NOT NULL, PRIMARY KEY (owner, bean, promise)
    );
    CREATE INDEX IF NOT EXISTS collaboration_consumers ON collaboration_reliance(bean, promise, owner);
    CREATE TABLE IF NOT EXISTS collaboration_posts (
      id INTEGER PRIMARY KEY, thread TEXT NOT NULL, bean TEXT NOT NULL, body TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS collaboration_thread_posts ON collaboration_posts(thread, id);
    CREATE TABLE IF NOT EXISTS collaboration_participants (
      thread TEXT NOT NULL, bean TEXT NOT NULL, PRIMARY KEY (thread, bean)
    );
    CREATE INDEX IF NOT EXISTS collaboration_participant_threads ON collaboration_participants(bean, thread);
    CREATE TABLE IF NOT EXISTS collaboration_inbox (
      bean TEXT NOT NULL, event_id INTEGER NOT NULL, acknowledged INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (bean, event_id)
    );
    CREATE INDEX IF NOT EXISTS collaboration_unread ON collaboration_inbox(bean, acknowledged, event_id);
    CREATE TABLE IF NOT EXISTS collaboration_idempotency (
      bean TEXT NOT NULL, actor TEXT NOT NULL, key TEXT NOT NULL, payload TEXT NOT NULL, result TEXT NOT NULL,
      PRIMARY KEY (bean, actor, key)
    )
`;

function indexBean(sql: SqlStorage, bean: BeanRecord): void {
  const row = sql
    .exec<{ id: number }>('SELECT rowid AS id FROM collaboration_beans WHERE bean = ?', bean.bean)
    .one();
  sql.exec('DELETE FROM collaboration_search WHERE rowid = ?', row.id);
  sql.exec(
    'INSERT INTO collaboration_search (rowid, bean, intent, approach) VALUES (?, ?, ?, ?)',
    row.id,
    bean.bean,
    bean.intent,
    bean.approach?.summary ?? '',
  );
  indexPaths(sql, { bean: bean.bean, source: 'approach', paths: bean.approach?.paths ?? [] });
}

function indexPaths(
  sql: SqlStorage,
  input: { bean: string; source: string; paths: readonly string[] },
): void {
  sql.exec(
    'DELETE FROM collaboration_paths WHERE bean = ? AND source = ?',
    input.bean,
    input.source,
  );
  for (const path of new Set(input.paths)) {
    sql.exec(
      'INSERT INTO collaboration_paths (bean, source, path) VALUES (?, ?, ?)',
      input.bean,
      input.source,
      path,
    );
  }
}
