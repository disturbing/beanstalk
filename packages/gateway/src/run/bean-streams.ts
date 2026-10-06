/**
 * Streaming diffs (`stream_diffs`): the latest working change of each bean whose agent is
 * writing, kept in the RunDO's SQLite beside the event log but never in it. The engine
 * never reads these rows; replays and summaries are unchanged. A snapshot is scanned for
 * secrets before it is stored, its seq must grow per invocation (a retried post is
 * ignored), and an invocation gets at most one accepted snapshot a second.
 */
import type { StreamFile, StreamResponse, StreamSnapshot } from '@beanstalk/shared-race/driver';
import type { BeanStream, BeanStreamSummary } from '@beanstalk/shared-race/rpc';

/** The least time between two accepted snapshots of one invocation. */
export const STREAM_MIN_INTERVAL_MS = 1000;

/** What a line becomes when the secret scan matches it. */
const REDACTED_LINE = '[redacted by beanstalk: looks like a secret]';

/**
 * Patterns that never reach a viewer: the ones the recorded fixtures are checked against
 * (`packages/web/scripts/build-fixtures.mjs`), less the 32-hex id, which code matches too
 * often. The driver scans with the same list before it posts (`harness/streamdiff.py`).
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /sk-ant-[a-z0-9-]{8,}/i,
  /\bbst1\.[A-Za-z0-9_-]{8,}/,
  /\bBearer\s+[A-Za-z0-9._-]{12,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bart_v1_[A-Za-z0-9_]{8,}/,
  /\/Users\/[A-Za-z0-9._-]+\//,
  /\/home\/[A-Za-z0-9._-]+\//,
  /\b[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev\b/i,
];

export type StoredStream = {
  readonly task: string;
  readonly inv: string;
  readonly seq: number;
  readonly atMs: number;
  readonly summary: BeanStreamSummary;
  readonly files: readonly StreamFile[];
};

/** Who posted the snapshot and when, as the RunDO knows it. */
export type StreamOrigin = {
  readonly task: string;
  readonly inv: string;
  readonly slot: string;
  readonly nowMs: number;
  /** Race seconds now. */
  readonly t: number;
};

export type StreamDecision =
  | { readonly kind: 'store'; readonly stream: StoredStream; readonly response: StreamResponse }
  | { readonly kind: 'ignore'; readonly response: StreamResponse };

/**
 * Whether to keep a posted snapshot, given the bean's stored one: older or equal seq of the
 * same invocation is stale, one within `STREAM_MIN_INTERVAL_MS` is rate limited.
 */
export function decideStream(
  previous: StoredStream | null,
  origin: StreamOrigin,
  snapshot: StreamSnapshot,
): StreamDecision {
  const same = previous !== null && previous.inv === origin.inv ? previous : null;
  if (same !== null && snapshot.seq <= same.seq)
    return { kind: 'ignore', response: { accepted: false, reason: 'stale', seq: same.seq } };
  if (same !== null && origin.nowMs - same.atMs < STREAM_MIN_INTERVAL_MS)
    return { kind: 'ignore', response: { accepted: false, reason: 'rate', seq: same.seq } };
  const { files, redacted } = redactFiles(snapshot.files);
  const stream: StoredStream = {
    task: origin.task,
    inv: origin.inv,
    seq: snapshot.seq,
    atMs: origin.nowMs,
    summary: summarize(origin, snapshot, files, redacted),
    files,
  };
  return { kind: 'store', stream, response: { accepted: true, seq: snapshot.seq } };
}

/** The RPC answer for one stored stream. */
export function beanStreamOf(stream: StoredStream): BeanStream {
  return { summary: stream.summary, files: stream.files };
}

/** Lines of patch text matching a secret pattern are replaced, never sent on. */
export function redactPatch(patch: string): { readonly text: string; readonly redacted: number } {
  let redacted = 0;
  const lines = patch.split('\n').map((line) => {
    if (!SECRET_PATTERNS.some((pattern) => pattern.test(line))) return line;
    redacted += 1;
    const marker = line.slice(0, 1);
    return `${['+', '-', ' '].includes(marker) ? marker : ''}${REDACTED_LINE}`;
  });
  return { text: lines.join('\n'), redacted };
}

function redactFiles(files: readonly StreamFile[]): {
  readonly files: readonly StreamFile[];
  readonly redacted: number;
} {
  let redacted = 0;
  const cleaned = files.map((file) => {
    const pathLeaks = SECRET_PATTERNS.some((pattern) => pattern.test(file.path));
    if (pathLeaks) {
      redacted += 1;
      return { ...file, path: 'redacted-path', patch: null };
    }
    if (file.patch === null) return file;
    const scan = redactPatch(file.patch);
    redacted += scan.redacted;
    return { ...file, patch: scan.text };
  });
  return { files: cleaned, redacted };
}

function summarize(
  origin: StreamOrigin,
  snapshot: StreamSnapshot,
  files: readonly StreamFile[],
  redacted: number,
): BeanStreamSummary {
  return {
    type: 'bean.streaming',
    task: origin.task,
    inv: origin.inv,
    agent: origin.slot,
    seq: snapshot.seq,
    t: Math.round(origin.t * 1000) / 1000,
    files: files.map(({ path, status, additions, deletions }) => ({
      path,
      status,
      additions,
      deletions,
    })),
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    truncated: snapshot.truncated,
    redacted,
  };
}

// ---- storage: one row per bean -------------------------------------------------------------

/** Creates the streams table (idempotent; safe in the constructor). */
export function migrateStreams(sql: SqlStorage): void {
  sql.exec(
    `CREATE TABLE IF NOT EXISTS bean_streams (
       task TEXT PRIMARY KEY,
       inv TEXT NOT NULL,
       seq INTEGER NOT NULL,
       at_ms INTEGER NOT NULL,
       summary TEXT NOT NULL,
       files TEXT NOT NULL
     )`,
  );
}

export function saveStream(sql: SqlStorage, stream: StoredStream): void {
  sql.exec(
    `INSERT OR REPLACE INTO bean_streams (task, inv, seq, at_ms, summary, files)
     VALUES (?, ?, ?, ?, ?, ?)`,
    stream.task,
    stream.inv,
    stream.seq,
    stream.atMs,
    JSON.stringify(stream.summary),
    JSON.stringify(stream.files),
  );
}

export function loadStream(sql: SqlStorage, task: string): StoredStream | null {
  const rows = sql.exec<StreamRow>('SELECT * FROM bean_streams WHERE task = ?', task).toArray();
  const row = rows[0];
  return row === undefined ? null : fromRow(row);
}

export function loadStreams(sql: SqlStorage): readonly StoredStream[] {
  return sql.exec<StreamRow>('SELECT * FROM bean_streams ORDER BY task').toArray().map(fromRow);
}

export function deleteStream(sql: SqlStorage, task: string): void {
  sql.exec('DELETE FROM bean_streams WHERE task = ?', task);
}

type StreamRow = {
  task: string;
  inv: string;
  seq: number;
  at_ms: number;
  summary: string;
  files: string;
};

/** Rows are written only by `saveStream`, from validated snapshots. */
function fromRow(row: StreamRow): StoredStream {
  const summary: BeanStreamSummary = JSON.parse(row.summary);
  const files: readonly StreamFile[] = JSON.parse(row.files);
  return { task: row.task, inv: row.inv, seq: row.seq, atMs: row.at_ms, summary, files };
}
