/**
 * `work_overlaps`: before an agent edits files, the other beans on those paths. In flight
 * (someone is editing them now), on the sprout awaiting validation, or green within the last
 * few minutes; with each bean's intent, so the agent can fit its change to theirs.
 */
import type { SlotId, TaskId } from '@beanstalk/shared-race/ids';

import type { BeanRecord, BeanStatus } from '@beanstalk/shared-ask/forge/forge-source';

import type { ToolContext } from './tool-context';
import { branchOf, clip } from './tool-context';

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
  const [records, { state }] = await Promise.all([
    ctx.source.beansByPath(ctx.run, paths),
    ctx.snapshot(),
  ]);
  const since = state.clock - RECENT_SECONDS;
  const beans = records
    .filter((record) => isLive(record, since))
    .map((record) => toOverlap(record, paths))
    .toSorted((a, b) => rank(a.status) - rank(b.status));
  return { paths, beans, summary: summarize(beans) };
}

function isLive(record: BeanRecord, since: number): boolean {
  if (record.status === 'in-flight' || record.status === 'landed') return true;
  return record.status === 'green' && (record.landedAt ?? Number.NEGATIVE_INFINITY) >= since;
}

function toOverlap(record: BeanRecord, paths: readonly string[]): Overlap {
  return {
    bean: record.id,
    branch: branchOf(record.id),
    title: record.title,
    intent: clip(record.intent, INTENT_CHARS),
    slot: record.agent,
    status: record.status,
    overlap: paths.filter((path) => record.files.some((file) => touches(file, path))),
    files: record.files,
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
