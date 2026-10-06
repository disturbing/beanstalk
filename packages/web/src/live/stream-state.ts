/**
 * The browser's view of a run's streaming diffs (`stream_diffs`): per bean, the latest
 * summary (every viewer gets it) and, for the beans on screen, the files of the snapshot,
 * kept up to date by the stream feed's patches (docs/claude-17-streaming-diffs.md). Only the
 * files a patch carries are parsed again; the others keep their parsed hunks (and identity).
 */
import type {
  BeanStreamSocketMessage,
  BeanStreamSummary,
  BeanStreamView,
  StreamFile,
} from '@beanstalk/shared-ask/forge/bean-stream';
import { toFileDiff } from '@beanstalk/shared-ask/forge/bean-stream';
import type { FileDiff } from '@beanstalk/shared-ask/repo/repo-types';

/** A bean's files at one accepted seq of one invocation. */
export type BeanFiles = {
  readonly inv: string;
  readonly seq: number;
  readonly files: readonly FileDiff[];
};

export type BeanLive = {
  /** The latest summary; null while only the files arrived. */
  readonly summary: BeanStreamSummary | null;
  /** False once the invocation ended: the last files stay until the commit replaces them. */
  readonly writing: boolean;
  readonly files: BeanFiles | null;
};

export type LiveStreams = ReadonlyMap<string, BeanLive>;

const NOTHING: BeanLive = { summary: null, writing: false, files: null };

/** The state after one message of the stream feed (the same state when it changes nothing). */
export function applyStreamMessage(
  streams: LiveStreams,
  message: BeanStreamSocketMessage,
): LiveStreams {
  const known = streams.get(message.task) ?? NOTHING;
  const next = nextBean(known, message);
  if (next === known) return streams;
  return new Map(streams).set(message.task, next);
}

/** The first paint's snapshot (read through the GET route), kept unless the feed is ahead. */
export function seedStream(streams: LiveStreams, view: BeanStreamView): LiveStreams {
  const { summary } = view;
  const known = streams.get(summary.task) ?? NOTHING;
  const current = nextBean(known, summary);
  const held = current.files;
  if (held !== null && held.inv === summary.inv && held.seq >= summary.seq)
    return current === known ? streams : new Map(streams).set(summary.task, current);
  const files: BeanFiles = { inv: summary.inv, seq: summary.seq, files: view.files };
  return new Map(streams).set(summary.task, { ...current, files });
}

/** A bean's change ready to draw: the files with the summary of their invocation. */
export function beanView(bean: BeanLive | undefined): BeanStreamView | null {
  if (bean === undefined || bean.summary === null || bean.files === null) return null;
  if (bean.files.inv !== bean.summary.inv) return null;
  return { summary: { ...bean.summary, seq: bean.files.seq }, files: bean.files.files };
}

/** The summaries of the beans being written now, by task. */
export function writingSummaries(streams: LiveStreams): ReadonlyMap<string, BeanStreamSummary> {
  const writing = new Map<string, BeanStreamSummary>();
  for (const [task, bean] of streams)
    if (bean.writing && bean.summary !== null) writing.set(task, bean.summary);
  return writing;
}

function nextBean(known: BeanLive, message: BeanStreamSocketMessage): BeanLive {
  switch (message.type) {
    case 'bean.streaming':
      return withSummary(known, message);
    case 'bean.streaming.end':
      return known.summary?.inv === message.inv && known.writing
        ? { ...known, writing: false }
        : known;
    case 'bean.snapshot': {
      const held = known.files;
      if (held !== null && held.inv === message.inv && held.seq >= message.seq) return known;
      const files = byPath(message.files.map(toFileDiff));
      return { ...known, files: { inv: message.inv, seq: message.seq, files } };
    }
    case 'bean.patch':
      return withPatch(known, message);
    default:
      return assertNever(message);
  }
}

function withSummary(known: BeanLive, summary: BeanStreamSummary): BeanLive {
  const current = known.summary;
  if (current !== null && current.inv === summary.inv && current.seq >= summary.seq) return known;
  // A new invocation (a rework) starts from its own first files, never the last one's.
  const files = known.files !== null && known.files.inv !== summary.inv ? null : known.files;
  return { summary, writing: true, files };
}

function withPatch(
  known: BeanLive,
  patch: Extract<BeanStreamSocketMessage, { type: 'bean.patch' }>,
): BeanLive {
  const held = known.files;
  const changed = patch.files.map(toFileDiff);
  if (patch.base_seq === 0)
    return { ...known, files: { inv: patch.inv, seq: patch.seq, files: byPath(changed) } };
  // A patch on a snapshot this view does not hold is skipped: the feed sends a snapshot.
  if (held === null || held.inv !== patch.inv || held.seq !== patch.base_seq) return known;
  return {
    ...known,
    files: { inv: patch.inv, seq: patch.seq, files: merged(held, patch, changed) },
  };
}

function merged(
  held: BeanFiles,
  patch: { readonly files: readonly StreamFile[]; readonly removed: readonly string[] },
  changed: readonly FileDiff[],
): readonly FileDiff[] {
  const gone = new Set([...patch.removed, ...changed.map((file) => file.path)]);
  return byPath([...held.files.filter((file) => !gone.has(file.path)), ...changed]);
}

/** Git's order: bytewise by path, as the driver's diff lists the files. */
function byPath(files: readonly FileDiff[]): readonly FileDiff[] {
  return files.toSorted((a, b) => comparePaths(a.path, b.path));
}

function comparePaths(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function assertNever(value: never): never {
  throw new Error(`unexpected stream message: ${JSON.stringify(value)}`);
}
