/**
 * Streaming diffs (`stream_diffs`), the pure half of the run's `RunStreamDO`
 * (docs/claude-17-streaming-diffs.md): whether a driver's post is kept, and what it changes
 * in the bean's stored snapshot. A post is a delta against the snapshot accepted as its
 * `base_seq` (0: a full snapshot). Only the files in the delta are scanned for secrets and
 * written; the caps hold for the stored snapshot as a whole.
 */
import type { StreamDelta, StreamFile, StreamResponse } from '@gitstalk/shared-race/driver';
import { STREAM_MAX_FILES, STREAM_MAX_PATCH_BYTES } from '@gitstalk/shared-race/driver';
import type { BeanStreamPatch, BeanStreamSummary } from '@gitstalk/shared-race/rpc';

/** The least time between two accepted posts of one invocation. */
export const STREAM_MIN_INTERVAL_MS = 400;

/** The invocations whose agent writes the bean's code, and so may stream it. */
export const STREAMING_KINDS: ReadonlySet<string> = new Set(['initial', 'rework', 'sync', 'fixer']);

/** What a line becomes when the secret scan matches it. */
const REDACTED_LINE = '[redacted by gitstalk: looks like a secret]';

/**
 * Patterns that never reach a viewer: the ones the recorded fixtures are checked against
 * (`research/race/tools/build-fixtures.mjs`), less the 32-hex id, which code matches too
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

/** An invocation the RunDO opened for streaming (or a tombstone of one it closed first). */
export type StreamInvocation = {
  readonly inv: string;
  readonly task: string;
  readonly slot: string;
  readonly kind: string;
  readonly openedMs: number;
  /** Race seconds at the open: a post's `t` counts on from it. */
  readonly openedT: number;
  readonly closedMs: number | null;
};

/** The latest accepted snapshot of a bean, without its files. */
export type StoredBean = {
  readonly task: string;
  readonly inv: string;
  readonly agent: string;
  readonly seq: number;
  readonly atMs: number;
  readonly t: number;
  readonly truncated: boolean;
  readonly redacted: number;
  readonly additions: number;
  readonly deletions: number;
};

/** A stored file as the caps and the summary see it: its patch's size, not its text. */
export type StoredFileStat = {
  readonly path: string;
  readonly status: StreamFile['status'];
  readonly additions: number;
  readonly deletions: number;
  readonly binary: boolean;
  /** UTF-8 bytes of the patch; null when the file has none (binary, or past a cap). */
  readonly patchBytes: number | null;
  /** Lines the gateway's scan replaced in this file. */
  readonly redacted: number;
};

/** A file as it is written: the cleaned patch and what the scan replaced. */
export type StoredFile = StreamFile & { readonly redacted: number };

/** What an accepted post writes: the bean's row, the files in the delta, the paths that left. */
export type StreamWrite = {
  readonly bean: StoredBean;
  readonly upserts: readonly StoredFile[];
  /** Stored paths to delete (a full snapshot deletes every path it does not carry). */
  readonly deletes: readonly string[];
};

export type PostRefusal = {
  readonly code:
    | 'stream_off'
    | 'unknown_invocation'
    | 'closed_invocation'
    | 'wrong_slot'
    | 'invalid_state';
  readonly status: 403 | 404 | 409;
  readonly message: string;
};

export type PostDecision =
  | { readonly kind: 'refuse'; readonly refusal: PostRefusal }
  | { readonly kind: 'ignore'; readonly response: StreamResponse }
  | {
      readonly kind: 'apply';
      readonly response: StreamResponse;
      readonly write: StreamWrite;
      readonly summary: BeanStreamSummary;
      readonly patch: BeanStreamPatch;
    };

export type PostInput = {
  /** The run streams: the RunDO opened at least one invocation here. */
  readonly isStreamingRun: boolean;
  readonly invocation: StreamInvocation | null;
  /** The bean's stored snapshot (any invocation's), and its files' stats. */
  readonly bean: StoredBean | null;
  readonly files: readonly StoredFileStat[];
  readonly slot: string;
  readonly inv: string;
  readonly nowMs: number;
  readonly delta: StreamDelta;
};

/**
 * Whether to keep a post, and what it changes: ownership first (`refuse`), then `stale`
 * (seq not newer), `rate` (within `STREAM_MIN_INTERVAL_MS`) and `resync` (`base_seq` is not
 * the stored seq of this invocation) are ignored; anything else is applied.
 */
export function decidePost(input: PostInput): PostDecision {
  const refusal = ownershipRefusal(input);
  if (refusal !== null) return { kind: 'refuse', refusal };
  const { bean, delta, nowMs, inv } = input;
  const same = bean !== null && bean.inv === inv ? bean : null;
  const storedSeq = same?.seq ?? 0;
  if (same !== null && delta.seq <= same.seq) return ignored('stale', storedSeq);
  if (same !== null && nowMs - same.atMs < STREAM_MIN_INTERVAL_MS)
    return ignored('rate', storedSeq);
  if (delta.base_seq !== 0 && delta.base_seq !== storedSeq) return ignored('resync', storedSeq);
  return applied(input, same === null ? [] : input.files);
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

/** A file as the gateway keeps it: a leaking path hides the file's patch, leaking lines are replaced. */
export function redactFile(file: StreamFile): StoredFile {
  if (SECRET_PATTERNS.some((pattern) => pattern.test(file.path)))
    return { ...file, path: 'redacted-path', patch: null, redacted: 1 };
  if (file.patch === null) return { ...file, redacted: 0 };
  const scan = redactPatch(file.patch);
  return { ...file, patch: scan.text, redacted: scan.redacted };
}

/** UTF-8 bytes of a patch. */
export function patchBytes(patch: string | null): number | null {
  return patch === null ? null : new TextEncoder().encode(patch).byteLength;
}

/** The summary every viewer gets: the bean's files without patches. */
export function summaryOf(bean: StoredBean, files: readonly StoredFileStat[]): BeanStreamSummary {
  return {
    type: 'bean.streaming',
    task: bean.task,
    inv: bean.inv,
    agent: bean.agent,
    seq: bean.seq,
    t: bean.t,
    files: files.map(({ path, status, additions, deletions }) => ({
      path,
      status,
      additions,
      deletions,
    })),
    additions: bean.additions,
    deletions: bean.deletions,
    truncated: bean.truncated,
    redacted: bean.redacted,
  };
}

/** Race seconds now, counted on from the invocation's open (3 decimals). */
export function raceSeconds(invocation: StreamInvocation, nowMs: number): number {
  const t = invocation.openedT + Math.max(0, nowMs - invocation.openedMs) / 1000;
  return Math.round(t * 1000) / 1000;
}

/** Files in git's order (bytewise by path), as the driver's diff lists them. */
export function byPath<T extends { readonly path: string }>(files: readonly T[]): T[] {
  return files.toSorted((a, b) => comparePaths(a.path, b.path));
}

function comparePaths(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function ownershipRefusal(input: PostInput): PostRefusal | null {
  const { invocation, inv, slot } = input;
  if (invocation === null && !input.isStreamingRun)
    return {
      code: 'stream_off',
      status: 409,
      message: 'this run does not stream diffs (stream_diffs)',
    };
  if (invocation === null)
    return { code: 'unknown_invocation', status: 404, message: `${inv} is not streaming (yet)` };
  if (invocation.closedMs !== null)
    return { code: 'closed_invocation', status: 409, message: `${inv} is not running` };
  if (invocation.slot !== slot)
    return {
      code: 'wrong_slot',
      status: 403,
      message: `${inv} belongs to slot ${invocation.slot}`,
    };
  if (!STREAMING_KINDS.has(invocation.kind))
    return {
      code: 'invalid_state',
      status: 409,
      message: `a ${invocation.kind} invocation does not stream`,
    };
  return null;
}

function ignored(reason: 'stale' | 'rate' | 'resync', seq: number): PostDecision {
  return { kind: 'ignore', response: { accepted: false, reason, seq } };
}

/** Applies the delta to `base` (the same invocation's stored stats; none for a fresh stream). */
function applied(input: PostInput, base: readonly StoredFileStat[]): PostDecision {
  const { delta, nowMs, inv } = input;
  const invocation = input.invocation;
  if (invocation === null) throw new Error('an applied post has an invocation');
  const isFull = delta.base_seq === 0;
  const changed = delta.files.map(redactFile);
  const changedPaths = new Set(changed.map((file) => file.path));
  const removed = new Set(isFull ? [] : delta.removed.filter((path) => !changedPaths.has(path)));
  const kept = isFull ? [] : base.filter((f) => !changedPaths.has(f.path) && !removed.has(f.path));
  const fitted = fitCaps(kept, changed);
  const files = byPath([...kept, ...fitted.files.map(statOf)]);
  const bean: StoredBean = {
    task: invocation.task,
    inv,
    agent: invocation.slot,
    seq: delta.seq,
    atMs: nowMs,
    t: raceSeconds(invocation, nowMs),
    truncated: delta.truncated || fitted.overflowed || files.some(isCut),
    redacted: files.reduce((sum, file) => sum + file.redacted, 0),
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
  };
  const present = new Set(files.map((file) => file.path));
  const deletes = input.files.map((file) => file.path).filter((path) => !present.has(path));
  return {
    kind: 'apply',
    response: { accepted: true, seq: delta.seq },
    write: { bean, upserts: fitted.files, deletes },
    summary: summaryOf(bean, files),
    patch: {
      type: 'bean.patch',
      task: bean.task,
      inv,
      seq: delta.seq,
      base_seq: delta.base_seq,
      files: byPath(fitted.files.map(({ redacted: _redacted, ...file }) => file)),
      removed: isFull ? [] : base.map((f) => f.path).filter((path) => removed.has(path)),
    },
  };
}

/**
 * The changed files that fit beside the kept ones: past 200 files a new one is left out;
 * past 64 KB of patch text a file is kept without its patch.
 */
function fitCaps(
  kept: readonly StoredFileStat[],
  changed: readonly StoredFile[],
): { readonly files: readonly StoredFile[]; readonly overflowed: boolean } {
  let count = kept.length;
  let budget = STREAM_MAX_PATCH_BYTES - kept.reduce((sum, file) => sum + (file.patchBytes ?? 0), 0);
  let overflowed = false;
  const files: StoredFile[] = [];
  for (const file of changed) {
    if (count >= STREAM_MAX_FILES) {
      overflowed = true;
      continue;
    }
    count += 1;
    const bytes = patchBytes(file.patch) ?? 0;
    if (bytes > budget) {
      overflowed = true;
      files.push({ ...file, patch: null });
      continue;
    }
    budget -= bytes;
    files.push(file);
  }
  return { files, overflowed };
}

function statOf(file: StoredFile): StoredFileStat {
  const { path, status, additions, deletions, binary, redacted } = file;
  return {
    path,
    status,
    additions,
    deletions,
    binary,
    redacted,
    patchBytes: patchBytes(file.patch),
  };
}

/** A text file stored without its patch: some of the change is not shown. */
function isCut(file: StoredFileStat): boolean {
  return !file.binary && file.patchBytes === null && file.additions + file.deletions > 0;
}
