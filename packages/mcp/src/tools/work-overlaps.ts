/**
 * `work_overlaps`: before an agent edits files, the other beans on those paths. In flight
 * (someone is editing them now), on the sprout awaiting validation, or green within the last
 * few minutes; with each bean's intent, so the agent can fit its change to theirs.
 */
import type { SlotId, TaskId } from '@gitstalk/shared-race/ids';
import { TaskId as TaskIdSchema } from '@gitstalk/shared-race/ids';

import type { BeanStreamSummary } from '@gitstalk/shared-ask/forge/bean-stream';
import type { BeanRecord, BeanStatus } from '@gitstalk/shared-ask/forge/forge-source';

import type { ToolContext } from './tool-context';
import { branchOf, clip, editingNow } from './tool-context';

/** A green bean counts as "recently landed" for this many race seconds. */
const RECENT_SECONDS = 15 * 60;
const INTENT_CHARS = 400;

export type Overlap = {
  readonly bean: TaskId;
  readonly branch: string;
  readonly title: string;
  readonly intent: string;
  readonly slot: SlotId | null;
  readonly status: BeanStatus;
  /** The asked paths this bean changes (or that sit under a folder it changes). */
  readonly overlap: readonly string[];
  readonly files: readonly string[];
  /** `stream_diffs`: files its agent is editing right now, not committed yet. */
  readonly editing_now: readonly string[];
};

export type WorkOverlaps = {
  readonly paths: readonly string[];
  readonly beans: readonly Overlap[];
  readonly summary: string;
};

export async function workOverlaps(
  ctx: ToolContext,
  paths: readonly string[],
): Promise<WorkOverlaps> {
  const [records, { state }, editing] = await Promise.all([
    ctx.source.beansByPath(ctx.run, paths),
    ctx.snapshot(),
    editingNow(ctx),
  ]);
  const since = state.clock - RECENT_SECONDS;
  const observed = await observedOnly(ctx, records, editing, paths);
  const beans = [...records, ...observed]
    .filter((record) => editing.has(record.id) || isLive(record, since))
    .map((record) => toOverlap(record, paths, editing.get(record.id)))
    .toSorted((a, b) => rank(a.status) - rank(b.status));
  return { paths, beans, summary: summarize(beans) };
}

/** Beans with no commit on these paths yet whose agents are editing them now. */
async function observedOnly(
  ctx: ToolContext,
  records: readonly BeanRecord[],
  editing: ReadonlyMap<string, BeanStreamSummary>,
  paths: readonly string[],
): Promise<readonly BeanRecord[]> {
  const known = new Set<string>(records.map((record) => record.id));
  const tasks = [...editing.values()]
    .filter((stream) => !known.has(stream.task))
    .filter((stream) => stream.files.some((file) => paths.some((path) => touches(file.path, path))))
    .flatMap((stream) => {
      const task = TaskIdSchema.safeParse(stream.task);
      return task.success ? [task.data] : [];
    });
  const details = await Promise.all(tasks.map((task) => ctx.source.beanDetail(ctx.run, task)));
  return details.filter((detail) => detail !== undefined);
}

function isLive(record: BeanRecord, since: number): boolean {
  if (record.status === 'in-flight' || record.status === 'landed') return true;
  return record.status === 'green' && (record.landedAt ?? Number.NEGATIVE_INFINITY) >= since;
}

function toOverlap(
  record: BeanRecord,
  paths: readonly string[],
  stream: BeanStreamSummary | undefined,
): Overlap {
  const editing = stream?.files.map((file) => file.path) ?? [];
  const files = [...new Set([...record.files, ...editing])];
  return {
    bean: record.id,
    branch: branchOf(record.id),
    title: record.title,
    intent: clip(record.intent, INTENT_CHARS),
    slot: record.agent,
    status: record.status,
    overlap: paths.filter((path) => files.some((file) => touches(file, path))),
    files: record.files,
    editing_now: editing,
  };
}

/** A file overlaps a path when they are equal or one is a folder holding the other. */
function touches(file: string, path: string): boolean {
  return file === path || file.startsWith(asFolder(path)) || path.startsWith(asFolder(file));
}

function asFolder(path: string): string {
  return path.endsWith('/') ? path : `${path}/`;
}

/** In flight first: those are the edits that can still collide. */
const RANK: Readonly<Record<BeanStatus, number>> = {
  'in-flight': 0,
  landed: 1,
  green: 2,
  pending: 3,
  reverted: 3,
  dropped: 3,
  parked: 3,
};

function rank(status: BeanStatus): number {
  return RANK[status];
}

function summarize(beans: readonly Overlap[]): string {
  if (beans.length === 0) return 'No bean in flight or recently landed touches these paths.';
  const listed = beans.map(
    (bean) => `${bean.bean} (${bean.status}${bean.slot === null ? '' : `, ${bean.slot}`})`,
  );
  return `${beans.length} bean${beans.length === 1 ? '' : 's'} on these paths: ${listed.join(', ')}. Read their intents before editing.`;
}
