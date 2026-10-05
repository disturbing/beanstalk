/**
 * The compressed stalk (`docs/claude-opus/14` §10, design v2): beans in flight at the growing
 * tip, then one leaf per landing, newest first, young on the sprout and mature on the stalk,
 * with a red mark for a bean that turned the sprout red and faint rows for beans that fell
 * off. Derived from the race state at the playhead.
 */
import type { SlotId, TaskId } from '@beanstalk/shared-race/ids';

import { isInFlight } from '../race/race-counters';
import type { RaceEvent } from '../race/race-events';
import type { BeanPhase, LineCommit, RaceState } from '../race/race-state';

/** How long the validation moment (a batch maturing together) stays marked, in race seconds. */
const MATURE_SECONDS = 10;
/** Past this many landings, older validated leaves fold into one row per validation. */
const FOLD_OVER = 60;
/** Landings always shown leaf by leaf when folding. */
const KEEP_LEAVES = 30;

export type LeafStatus = 'sprout' | 'stalk' | 'red';

export type StalkRow =
  | {
      readonly kind: 'bean';
      readonly key: string;
      readonly task: TaskId;
      readonly title: string;
      readonly slot: SlotId | null;
      readonly phase: BeanPhase;
    }
  | { readonly kind: 'idle'; readonly key: string; readonly finished: boolean }
  /** Ideas not started yet: one row for all of them. */
  | { readonly kind: 'queued'; readonly key: string; readonly count: number }
  /** The validation moment: this many sprouts just matured into the stalk together. */
  | { readonly kind: 'matured'; readonly key: string; readonly t: number; readonly count: number }
  | {
      readonly kind: 'leaf';
      readonly key: string;
      readonly task: TaskId | null;
      readonly title: string;
      readonly idx: number;
      readonly t: number;
      readonly status: LeafStatus;
      /** Matured into the stalk in the validation that just passed. */
      readonly matured: boolean;
    }
  | {
      readonly kind: 'fell';
      readonly key: string;
      readonly task: TaskId;
      readonly title: string;
      readonly t: number;
      readonly reason: string;
    }
  | { readonly kind: 'fold'; readonly key: string; readonly t: number; readonly count: number };

export type StalkInput = {
  readonly state: RaceState;
  readonly events: readonly RaceEvent[];
  readonly now: number;
  readonly titles: Readonly<Record<string, string>>;
};

export function stalkRows(input: StalkInput): readonly StalkRow[] {
  return [...tipRows(input), ...lineRows(input)];
}

function tipRows({ state, now, titles }: StalkInput): readonly StalkRow[] {
  const flying = Object.values(state.beans)
    .filter((bean) => isInFlight(bean.phase) && bean.startedAt !== null)
    .toSorted((a, b) => slotNumber(a.agent) - slotNumber(b.agent));
  const queued = Object.values(state.beans).filter((bean) => bean.phase === 'pending').length;
  const ideas: readonly StalkRow[] =
    queued > 0 ? [{ kind: 'queued', key: 'queued', count: queued }] : [];
  if (flying.length === 0) {
    return [
      ...ideas,
      { kind: 'idle', key: 'idle', finished: state.endedAt !== null && now >= state.endedAt },
    ];
  }
  return [
    ...ideas,
    ...flying.map((bean): StalkRow => ({
      kind: 'bean',
      key: `b-${bean.id}`,
      task: bean.id,
      title: titles[bean.id] ?? bean.id,
      slot: bean.agent,
      phase: bean.phase,
    })),
  ];
}

/** The validation that just passed and the landings it matured, if one passed a moment ago. */
function justMatured(
  input: StalkInput,
): { readonly t: number; readonly from: number; readonly to: number } | null {
  const promotes = input.events.flatMap((event) =>
    event.type === 'green.promote' && event.t <= input.now && event.trunk_idx !== undefined
      ? [{ t: event.t, idx: event.trunk_idx }]
      : [],
  );
  const latest = promotes.at(-1);
  if (latest === undefined || input.now - latest.t > MATURE_SECONDS) return null;
  const before = promotes.at(-2)?.idx ?? -1;
  return { t: latest.t, from: before + 1, to: latest.idx };
}

type Item =
  | { readonly t: number; readonly commit: LineCommit }
  | { readonly t: number; readonly fell: { readonly task: TaskId; readonly reason: string } };

function lineRows(input: StalkInput): readonly StalkRow[] {
  const { state, now, titles } = input;
  const stalkIdx = state.line.stalkIdx;
  const culprits = new Set(
    state.tickets.flatMap((ticket) => (ticket.culprit === null ? [] : [ticket.culprit])),
  );
  const items = [
    ...state.line.commits
      .filter((commit) => commit.t <= now)
      .map((commit): Item => ({ t: commit.t, commit })),
    ...Object.values(state.beans)
      .filter((bean) => bean.phase === 'dropped' && bean.since <= now)
      .map((bean): Item => ({
        t: bean.since,
        fell: { task: bean.id, reason: bean.dropReason ?? 'dropped' },
      })),
  ].toSorted((a, b) => b.t - a.t);
  const folds = foldGroups(input, items);
  const rows: StalkRow[] = [];
  const moment = justMatured(input);
  let bracket = false;
  const folded = new Set<number>();
  for (const item of items) {
    if ('fell' in item) {
      rows.push({
        kind: 'fell',
        key: `d-${item.fell.task}`,
        task: item.fell.task,
        title: titles[item.fell.task] ?? item.fell.task,
        t: item.t,
        reason: item.fell.reason,
      });
      continue;
    }
    const { commit } = item;
    const group = folds.get(commit.idx);
    if (group !== undefined) {
      if (!folded.has(group.t))
        rows.push({ kind: 'fold', key: `f-${group.t}`, t: group.t, count: group.count });
      folded.add(group.t);
      continue;
    }
    const matured = moment !== null && commit.idx >= moment.from && commit.idx <= moment.to;
    if (matured && moment !== null && !bracket) {
      rows.push({
        kind: 'matured',
        key: `m-${moment.t}`,
        t: moment.t,
        count: moment.to - moment.from + 1,
      });
      bracket = true;
    }
    const red = commit.status === 'culprit' || (commit.task !== null && culprits.has(commit.task));
    rows.push({
      kind: 'leaf',
      key: `l-${commit.idx}`,
      task: commit.task,
      title: commit.task === null ? commit.kind : (titles[commit.task] ?? commit.task),
      idx: commit.idx,
      t: commit.t,
      status: leafStatus(red, commit.idx <= stalkIdx),
      matured,
    });
  }
  return rows;
}

function leafStatus(red: boolean, onStalk: boolean): LeafStatus {
  if (red) return 'red';
  return onStalk ? 'stalk' : 'sprout';
}

/** For long lines: old validated landings by the validation that settled them. */
function foldGroups(
  input: StalkInput,
  items: readonly Item[],
): ReadonlyMap<number, { readonly t: number; readonly count: number }> {
  const commits = items.flatMap((item) => ('commit' in item ? [item.commit] : []));
  if (commits.length <= FOLD_OVER) return new Map();
  const keepFrom = commits[KEEP_LEAVES - 1]?.idx ?? 0;
  const promotes = input.events.flatMap((event) =>
    event.type === 'green.promote' && event.t <= input.now ? [event] : [],
  );
  const groups = new Map<number, { t: number; count: number }>();
  const byIdx = new Map<number, { t: number; count: number }>();
  for (const commit of commits) {
    if (commit.idx >= keepFrom || commit.idx > input.state.line.stalkIdx) continue;
    const promote = promotes.find((event) => (event.trunk_idx ?? -1) >= commit.idx);
    if (promote === undefined) continue;
    const group = groups.get(promote.t) ?? { t: promote.t, count: 0 };
    group.count += 1;
    groups.set(promote.t, group);
    byIdx.set(commit.idx, group);
  }
  return byIdx;
}

function slotNumber(slot: SlotId | null): number {
  return slot === null ? Number.MAX_SAFE_INTEGER : Number(slot.slice(1));
}
