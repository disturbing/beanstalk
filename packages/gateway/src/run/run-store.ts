/**
 * The RunDO's storage. The append-only event log is a SQLite table (read back by range for
 * `GET /events`); the run's metadata, configuration, repos and the engine state snapshot
 * are values in the object's synchronous KV store, written in the same step as the events.
 */
import type { RunId } from '@beanstalk/shared-race/ids';
import type { RunConfig } from '@beanstalk/shared-race/run-config';

import type { EmittedEvent } from '../engine/model';
import type { EngineState } from '../engine/state';
import type { RunRepos } from './run-jobs';

export type RunMeta = {
  readonly run: RunId;
  readonly createdAtMs: number;
};

/** Everything a RunDO keeps about its run. */
export type StoredRun = {
  readonly meta: RunMeta;
  readonly config: RunConfig;
  readonly repos: RunRepos;
  readonly state: EngineState;
};

const KEYS = { meta: 'meta', config: 'config', repos: 'repos', state: 'state' } as const;

/** Creates the events table if it does not exist (idempotent; safe in the constructor). */
export function migrate(sql: SqlStorage): void {
  sql.exec(
    `CREATE TABLE IF NOT EXISTS events (
       seq INTEGER PRIMARY KEY,
       t REAL NOT NULL,
       type TEXT NOT NULL,
       body TEXT NOT NULL
     )`,
  );
}

export function loadRun(storage: DurableObjectStorage): StoredRun | null {
  const meta = storage.kv.get<RunMeta>(KEYS.meta);
  const config = storage.kv.get<RunConfig>(KEYS.config);
  const repos = storage.kv.get<RunRepos>(KEYS.repos);
  const state = storage.kv.get<EngineState>(KEYS.state);
  if (meta === undefined || config === undefined || repos === undefined || state === undefined)
    return null;
  return { meta, config, repos, state };
}

export function saveNewRun(storage: DurableObjectStorage, run: StoredRun): void {
  storage.kv.put(KEYS.meta, run.meta);
  storage.kv.put(KEYS.config, run.config);
  storage.kv.put(KEYS.repos, run.repos);
  storage.kv.put(KEYS.state, run.state);
}

/** Persists a step: the new state and its events, atomically (no await in between). */
export function saveStep(
  storage: DurableObjectStorage,
  state: EngineState,
  events: readonly EmittedEvent[],
): void {
  storage.kv.put(KEYS.state, state);
  for (const event of events) {
    storage.sql.exec(
      'INSERT INTO events (seq, t, type, body) VALUES (?, ?, ?, ?)',
      event.seq,
      event.t,
      event.type,
      JSON.stringify(event),
    );
  }
}

/** Event bodies (JSON text) after `after`, in order, at most `limit`. */
/** Every event of the given types, in order (the web app's bean and decision views). */
export function readEventsOfTypes(sql: SqlStorage, types: readonly string[]): string[] {
  if (types.length === 0) return [];
  const marks = types.map(() => '?').join(', ');
  return sql
    .exec<{ body: string }>(
      `SELECT body FROM events WHERE type IN (${marks}) ORDER BY seq`,
      ...types,
    )
    .toArray()
    .map((row) => row.body);
}

export function readEvents(
  sql: SqlStorage,
  after: number,
  limit: number,
): { seq: number; body: string }[] {
  return sql
    .exec<{ seq: number; body: string }>(
      'SELECT seq, body FROM events WHERE seq > ? ORDER BY seq LIMIT ?',
      after,
      limit,
    )
    .toArray();
}
