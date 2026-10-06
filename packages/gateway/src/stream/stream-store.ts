/**
 * The `RunStreamDO`'s SQLite: the invocations the RunDO opened, the latest snapshot's
 * summary per bean, and that snapshot's files, one row each, so a post writes only the files
 * it changed. Never the event log: replays and summaries do not see these tables.
 */
import type { StreamFile } from '@beanstalk/shared-race/driver';

import { patchBytes as patchBytesOf } from './stream-rules';
import type {
  StoredBean,
  StoredFile,
  StoredFileStat,
  StreamInvocation,
  StreamWrite,
} from './stream-rules';

/** What the RunDO opens: an invocation that may stream, and when it is swept at the latest. */
export type StreamOpen = {
  readonly inv: string;
  readonly task: string;
  readonly slot: string;
  readonly kind: string;
  /** Race seconds at the open. */
  readonly t: number;
  /** After this long without a close, the alarm sweep closes it. */
  readonly ttlMs: number;
};

export type StreamClose = { readonly inv: string; readonly task: string; readonly t: number };

/** Rows and patch bytes a write touched, for the `stream post` log and the store's counters. */
export type WriteCost = { readonly rows: number; readonly patchBytes: number };

/** Creates the tables (idempotent; safe in the constructor). */
export function migrateStreamStore(sql: SqlStorage): void {
  sql.exec(`CREATE TABLE IF NOT EXISTS stream_run (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     opened_ms INTEGER NOT NULL,
     finished_ms INTEGER
   )`);
  sql.exec(`CREATE TABLE IF NOT EXISTS stream_invocations (
     inv TEXT PRIMARY KEY,
     task TEXT NOT NULL,
     slot TEXT NOT NULL,
     kind TEXT NOT NULL,
     opened_ms INTEGER NOT NULL,
     opened_t REAL NOT NULL,
     expires_ms INTEGER NOT NULL,
     closed_ms INTEGER
   )`);
  sql.exec(`CREATE TABLE IF NOT EXISTS stream_beans (
     task TEXT PRIMARY KEY,
     inv TEXT NOT NULL,
     agent TEXT NOT NULL,
     seq INTEGER NOT NULL,
     at_ms INTEGER NOT NULL,
     t REAL NOT NULL,
     truncated INTEGER NOT NULL,
     redacted INTEGER NOT NULL,
     additions INTEGER NOT NULL,
     deletions INTEGER NOT NULL
   )`);
  sql.exec(`CREATE TABLE IF NOT EXISTS stream_files (
     task TEXT NOT NULL,
     path TEXT NOT NULL,
     status TEXT NOT NULL,
     additions INTEGER NOT NULL,
     deletions INTEGER NOT NULL,
     binary INTEGER NOT NULL,
     redacted INTEGER NOT NULL,
     patch TEXT,
     PRIMARY KEY (task, path)
   ) WITHOUT ROWID`);
}

/** Whether the RunDO ever opened a stream here (the run streams). */
export function isStreamingRun(sql: SqlStorage): boolean {
  return sql.exec('SELECT 1 FROM stream_run WHERE id = 1').toArray().length > 0;
}

/**
 * Opens invocations; one already known (opened, or closed first by a close that overtook
 * its open) stays as it is.
 */
export function openInvocations(
  sql: SqlStorage,
  opens: readonly StreamOpen[],
  nowMs: number,
): void {
  sql.exec('INSERT OR IGNORE INTO stream_run (id, opened_ms) VALUES (1, ?)', nowMs);
  for (const open of opens) {
    sql.exec(
      `INSERT OR IGNORE INTO stream_invocations
         (inv, task, slot, kind, opened_ms, opened_t, expires_ms, closed_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      open.inv,
      open.task,
      open.slot,
      open.kind,
      nowMs,
      open.t,
      nowMs + open.ttlMs,
    );
  }
}

/** Closes an invocation; an unknown one is remembered closed, so a late open cannot reopen it. */
export function closeInvocation(sql: SqlStorage, close: StreamClose, nowMs: number): void {
  sql.exec(
    `INSERT INTO stream_invocations
       (inv, task, slot, kind, opened_ms, opened_t, expires_ms, closed_ms)
     VALUES (?, ?, '', '', ?, ?, ?, ?)
     ON CONFLICT (inv) DO UPDATE SET closed_ms = COALESCE(closed_ms, excluded.closed_ms)`,
    close.inv,
    close.task,
    nowMs,
    close.t,
    nowMs,
    nowMs,
  );
}

export function loadInvocation(sql: SqlStorage, inv: string): StreamInvocation | null {
  const row = sql
    .exec<InvocationRow>('SELECT * FROM stream_invocations WHERE inv = ?', inv)
    .toArray()[0];
  return row === undefined ? null : invocationOf(row);
}

/** Open invocations whose sweep time has come. */
export function expiredInvocations(sql: SqlStorage, nowMs: number): StreamInvocation[] {
  return sql
    .exec<InvocationRow>(
      'SELECT * FROM stream_invocations WHERE closed_ms IS NULL AND expires_ms <= ? ORDER BY inv',
      nowMs,
    )
    .toArray()
    .map(invocationOf);
}

export function hasOpenInvocations(sql: SqlStorage): boolean {
  return (
    sql.exec('SELECT 1 FROM stream_invocations WHERE closed_ms IS NULL LIMIT 1').toArray().length >
    0
  );
}

export function loadBean(sql: SqlStorage, task: string): StoredBean | null {
  const row = sql.exec<BeanRow>('SELECT * FROM stream_beans WHERE task = ?', task).toArray()[0];
  return row === undefined ? null : beanOf(row);
}

export function loadBeans(sql: SqlStorage): StoredBean[] {
  return sql.exec<BeanRow>('SELECT * FROM stream_beans ORDER BY task').toArray().map(beanOf);
}

/** A bean's files without their patches (sizes only), in path order. */
export function loadFileStats(sql: SqlStorage, task: string): StoredFileStat[] {
  return sql
    .exec<FileStatRow>(
      `SELECT path, status, additions, deletions, binary, redacted,
              length(CAST(patch AS BLOB)) AS patch_bytes
       FROM stream_files WHERE task = ? ORDER BY path`,
      task,
    )
    .toArray()
    .map((row) => ({
      path: row.path,
      status: statusOf(row.status),
      additions: row.additions,
      deletions: row.deletions,
      binary: row.binary === 1,
      redacted: row.redacted,
      patchBytes: row.patch_bytes,
    }));
}

/** A bean's files with their patches, in path order. */
export function loadFiles(sql: SqlStorage, task: string): StreamFile[] {
  return sql
    .exec<FileRow>(
      `SELECT path, status, additions, deletions, binary, patch
       FROM stream_files WHERE task = ? ORDER BY path`,
      task,
    )
    .toArray()
    .map((row) => ({
      path: row.path,
      status: statusOf(row.status),
      additions: row.additions,
      deletions: row.deletions,
      binary: row.binary === 1,
      patch: row.patch,
    }));
}

/** Writes an accepted post: the bean's row, the changed files, the removed paths. */
export function writePost(sql: SqlStorage, write: StreamWrite): WriteCost {
  const { bean } = write;
  let rows = sql.exec(
    `INSERT OR REPLACE INTO stream_beans
       (task, inv, agent, seq, at_ms, t, truncated, redacted, additions, deletions)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    bean.task,
    bean.inv,
    bean.agent,
    bean.seq,
    bean.atMs,
    bean.t,
    bean.truncated ? 1 : 0,
    bean.redacted,
    bean.additions,
    bean.deletions,
  ).rowsWritten;
  for (const path of write.deletes)
    rows += sql.exec(
      'DELETE FROM stream_files WHERE task = ? AND path = ?',
      bean.task,
      path,
    ).rowsWritten;
  let patchBytes = 0;
  for (const file of write.upserts) {
    rows += upsertFile(sql, bean.task, file);
    patchBytes += patchBytesOf(file.patch) ?? 0;
  }
  return { rows, patchBytes };
}

/** Drops a bean's snapshot. */
export function deleteBean(sql: SqlStorage, task: string): void {
  sql.exec('DELETE FROM stream_files WHERE task = ?', task);
  sql.exec('DELETE FROM stream_beans WHERE task = ?', task);
}

/** The run is over: every invocation closes and no snapshot stays. */
export function finishRun(sql: SqlStorage, nowMs: number): void {
  sql.exec('UPDATE stream_invocations SET closed_ms = ? WHERE closed_ms IS NULL', nowMs);
  sql.exec('UPDATE stream_run SET finished_ms = COALESCE(finished_ms, ?)', nowMs);
  sql.exec('DELETE FROM stream_files');
  sql.exec('DELETE FROM stream_beans');
}

function upsertFile(sql: SqlStorage, task: string, file: StoredFile): number {
  return sql.exec(
    `INSERT OR REPLACE INTO stream_files
       (task, path, status, additions, deletions, binary, redacted, patch)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    task,
    file.path,
    file.status,
    file.additions,
    file.deletions,
    file.binary ? 1 : 0,
    file.redacted,
    file.patch,
  ).rowsWritten;
}

type InvocationRow = {
  inv: string;
  task: string;
  slot: string;
  kind: string;
  opened_ms: number;
  opened_t: number;
  expires_ms: number;
  closed_ms: number | null;
};

type BeanRow = {
  task: string;
  inv: string;
  agent: string;
  seq: number;
  at_ms: number;
  t: number;
  truncated: number;
  redacted: number;
  additions: number;
  deletions: number;
};

type FileStatRow = {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  binary: number;
  redacted: number;
  patch_bytes: number | null;
};

type FileRow = {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  binary: number;
  patch: string | null;
};

function invocationOf(row: InvocationRow): StreamInvocation {
  return {
    inv: row.inv,
    task: row.task,
    slot: row.slot,
    kind: row.kind,
    openedMs: row.opened_ms,
    openedT: row.opened_t,
    closedMs: row.closed_ms,
  };
}

function beanOf(row: BeanRow): StoredBean {
  return {
    task: row.task,
    inv: row.inv,
    agent: row.agent,
    seq: row.seq,
    atMs: row.at_ms,
    t: row.t,
    truncated: row.truncated === 1,
    redacted: row.redacted,
    additions: row.additions,
    deletions: row.deletions,
  };
}

/** Rows are written only from validated posts, so the status is one of the three. */
function statusOf(status: string): StreamFile['status'] {
  return status === 'added' || status === 'deleted' ? status : 'modified';
}
