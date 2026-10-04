/**
 * The Plot (`docs/claude-opus/14` §4): every landing as a row (newest first, growing up the
 * stalk), every area of the code as a column, and the beans in flight as buds at the tip.
 * Pure: the page derives it from the race state at the playhead, so replays and live runs
 * share it.
 */
import type { SlotId, TaskId } from '@beanstalk/shared-race/ids';

import { isInFlight } from '../race/race-counters';
import type { RaceEvent } from '../race/race-events';
import type { BeanPhase, LineCommit, RaceState } from '../race/race-state';
import { isTestFile } from '../repo/imports';
import type { FileStat } from '../repo/repo-types';

/** Areas shown as their own column; the rest share `other`. */
const MAX_BEDS = 14;
/** A merge conflict counts as current for this long. */
const CONFLICT_WINDOW_SECONDS = 45;
/** Files a question can open as columns before the Plot shows areas instead. */
const MAX_FILE_COLUMNS = 12;

/** What a question narrows the Plot to. */
export type PlotFocus = {
  readonly files: readonly string[];
  readonly beans: readonly string[];
  /** `files`: matched files become columns; `beds`: areas stay, matched beans are marked. */
  readonly layout: 'files' | 'beds';
};

export type PlotColumn =
  | { readonly kind: 'bed'; readonly bed: string }
  | { readonly kind: 'file'; readonly bed: string; readonly path: string }
  | { readonly kind: 'folded'; readonly bed: string };

export type PlotCell = {
  readonly column: number;
  readonly lines: number;
  readonly testsOnly: boolean;
};

export type LeafStatus = 'stalk' | 'sprout' | 'culprit' | 'reverted';

export type PlotRow =
  | {
      readonly kind: 'landing';
      readonly idx: number;
      readonly task: TaskId | null;
      readonly title: string;
      readonly t: number;
      readonly status: LeafStatus;
      readonly cells: readonly PlotCell[];
      /** `match`: the question is about this bean; `related`: it only touches the files. */
      readonly emphasis: 'plain' | 'match' | 'related';
    }
  | { readonly kind: 'fold'; readonly count: number; readonly status: LeafStatus };

export type BudCell = {
  readonly column: number;
  /** `wrote`: the bean changed files here; `planned`: only its predicted footprint. */
  readonly mark: 'wrote' | 'planned';
  /** Another bean in flight changes one of the same files. */
  readonly overlap: boolean;
  readonly conflict: boolean;
};

export type PlotBud = {
  readonly task: TaskId;
  readonly title: string;
  readonly agent: SlotId | null;
  readonly phase: BeanPhase;
  readonly since: number;
  readonly cells: readonly BudCell[];
};

export type PlotModel = {
  readonly columns: readonly PlotColumn[];
  /** Beans in flight per column. */
  readonly crowd: readonly number[];
  /** A merge conflict happened in the column's area within the last 45 s. */
  readonly hot: readonly boolean[];
  readonly buds: readonly PlotBud[];
  readonly rows: readonly PlotRow[];
};

export type PlotInput = {
  readonly state: RaceState;
  /** Events up to the playhead (for recent conflicts). */
  readonly events: readonly RaceEvent[];
  readonly now: number;
  /** The repository's areas, from `bedsOf`, fixed for the page. */
  readonly beds: readonly string[];
  /** Per-file line counts of each line commit, by sha; missing ones count as one line. */
  readonly stats: Readonly<Record<string, readonly FileStat[]>>;
  readonly titles: Readonly<Record<string, string>>;
  readonly focus: PlotFocus | null;
};

export function plotModel(input: PlotInput): PlotModel {
  const columns = plotColumns(input.beds, input.focus);
  const locate = columnLocator(columns, input.beds);
  const hotBeds = recentConflictBeds(input.events, input.now, input.beds);
  const buds = budsOf({ input, locate, columns, hotBeds });
  return {
    columns,
    crowd: columns.map(
      (_, index) => buds.filter((bud) => bud.cells.some((cell) => cell.column === index)).length,
    ),
    hot: columns.map((column) => column.kind !== 'file' && hotBeds.has(column.bed)),
    buds,
    rows: rowsOf(input, locate),
  };
}

/** The area of a path: the directory under `src/` (or the top level), `core` for loose files. */
export function bedOf(path: string, beds: readonly string[] = []): string {
  const parts = path.split('/');
  const inside = parts[0] === 'src' ? parts.slice(1) : parts;
  const bed = inside.length > 1 ? (inside[0] ?? 'core') : 'core';
  if (beds.length === 0 || beds.includes(bed)) return bed;
  return beds.includes('other') ? 'other' : bed;
}

/** The repository's areas, most files first beyond the cap, shown in name order. */
export function bedsOf(paths: readonly string[]): readonly string[] {
  const counts = new Map<string, number>();
  for (const path of paths) counts.set(bedOf(path), (counts.get(bedOf(path)) ?? 0) + 1);
  const named = [...counts.keys()].filter((bed) => bed !== 'core');
  const kept =
    named.length <= MAX_BEDS - 1
      ? named
      : named
          .toSorted((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))
          .slice(0, MAX_BEDS - 2);
  const overflow = kept.length < named.length ? ['other'] : [];
  return [...kept.toSorted(), ...overflow, 'core'];
}

function plotColumns(beds: readonly string[], focus: PlotFocus | null): readonly PlotColumn[] {
  if (focus === null) return beds.map((bed) => ({ kind: 'bed', bed }));
  const asFiles = focus.layout === 'files' && focus.files.length <= MAX_FILE_COLUMNS;
  return beds.flatMap((bed): readonly PlotColumn[] => {
    const files = focus.files
      .filter((path) => bedOf(path, beds) === bed)
      .toSorted((a, b) => Number(isTestFile(a)) - Number(isTestFile(b)) || a.localeCompare(b));
    if (asFiles && files.length > 0) return files.map((path) => ({ kind: 'file', bed, path }));
    if (focus.layout === 'beds' || files.length > 0) return [{ kind: 'bed', bed }];
    return [{ kind: 'folded', bed }];
  });
}

/** The column a changed file lands in, or undefined when that column is folded away. */
function columnLocator(columns: readonly PlotColumn[], beds: readonly string[]) {
  return (path: string): number | undefined => {
    const exact = columns.findIndex((column) => column.kind === 'file' && column.path === path);
    if (exact !== -1) return exact;
    const bed = bedOf(path, beds);
    const area = columns.findIndex((column) => column.kind === 'bed' && column.bed === bed);
    return area === -1 ? undefined : area;
  };
}

type Locate = ReturnType<typeof columnLocator>;

function rowsOf(input: PlotInput, locate: Locate): readonly PlotRow[] {
  const landed = input.state.line.commits
    .filter((commit) => commit.t <= input.now)
    .toSorted((a, b) => b.idx - a.idx);
  const rows: PlotRow[] = [];
  let folded: LineCommit[] = [];
  const flush = (): void => {
    const first = folded[0];
    if (first !== undefined)
      rows.push({ kind: 'fold', count: folded.length, status: leafStatus(first, input.state) });
    folded = [];
  };
  for (const commit of landed) {
    const emphasis = emphasisOf(commit, input.focus);
    if (emphasis === 'hidden') {
      folded.push(commit);
      continue;
    }
    flush();
    rows.push(landingRow({ commit, input, locate, emphasis }));
  }
  flush();
  return rows;
}

function landingRow(args: {
  readonly commit: LineCommit;
  readonly input: PlotInput;
  readonly locate: Locate;
  readonly emphasis: 'plain' | 'match' | 'related';
}): PlotRow {
  const { commit, input } = args;
  const stats =
    input.stats[commit.sha] ?? commit.files.map((path) => ({ path, additions: 1, deletions: 0 }));
  return {
    kind: 'landing',
    idx: commit.idx,
    task: commit.task,
    title: commit.task === null ? commit.kind : (input.titles[commit.task] ?? commit.task),
    t: commit.t,
    status: leafStatus(commit, input.state),
    cells: cellsOf(stats, args.locate),
    emphasis: args.emphasis,
  };
}

function cellsOf(
  stats: readonly Pick<FileStat, 'path' | 'additions' | 'deletions'>[],
  locate: Locate,
): readonly PlotCell[] {
  const byColumn = new Map<number, { lines: number; testsOnly: boolean }>();
  for (const stat of stats) {
    const column = locate(stat.path);
    if (column === undefined) continue;
    const current = byColumn.get(column) ?? { lines: 0, testsOnly: true };
    byColumn.set(column, {
      lines: current.lines + stat.additions + stat.deletions,
      testsOnly: current.testsOnly && isTestFile(stat.path),
    });
  }
  return [...byColumn]
    .map(([column, cell]) => ({ column, lines: cell.lines, testsOnly: cell.testsOnly }))
    .toSorted((a, b) => a.column - b.column);
}

function emphasisOf(
  commit: LineCommit,
  focus: PlotFocus | null,
): 'plain' | 'match' | 'related' | 'hidden' {
  if (focus === null) return 'plain';
  if (commit.task !== null && focus.beans.includes(commit.task)) return 'match';
  if (focus.layout === 'files' && commit.files.some((path) => focus.files.includes(path)))
    return 'related';
  return 'hidden';
}

/** A culprit keeps its red leaf after the sprout is green again: it is part of the story. */
function leafStatus(commit: LineCommit, state: RaceState): LeafStatus {
  if (commit.status === 'reverted') return 'reverted';
  const named = state.tickets.some(
    (ticket) => ticket.culprit !== null && ticket.culprit === commit.task,
  );
  if (commit.status === 'culprit' || named) return 'culprit';
  return commit.idx <= state.line.stalkIdx ? 'stalk' : 'sprout';
}

function budsOf(args: {
  readonly input: PlotInput;
  readonly locate: Locate;
  readonly columns: readonly PlotColumn[];
  readonly hotBeds: ReadonlySet<string>;
}): readonly PlotBud[] {
  const { input, locate, columns, hotBeds } = args;
  const flying = Object.values(input.state.beans).filter(
    (bean) => isInFlight(bean.phase) && bean.startedAt !== null,
  );
  const owners = new Map<string, number>();
  for (const bean of flying)
    for (const path of bean.files) owners.set(path, (owners.get(path) ?? 0) + 1);
  return flying
    .map((bean) => {
      const wrote = new Map<number, boolean>();
      for (const path of bean.files) {
        const column = locate(path);
        if (column !== undefined)
          wrote.set(column, (wrote.get(column) ?? false) || (owners.get(path) ?? 0) > 1);
      }
      const planned = bean.predicted
        .map((module) => locate(`${module}/_`))
        .filter((column): column is number => column !== undefined && !wrote.has(column));
      const cells: BudCell[] = [
        ...[...wrote].map(([column, overlap]) => ({
          column,
          mark: 'wrote' as const,
          overlap,
          conflict: hotBeds.has(columns[column]?.bed ?? ''),
        })),
        ...[...new Set(planned)].map((column) => ({
          column,
          mark: 'planned' as const,
          overlap: false,
          conflict: false,
        })),
      ];
      return {
        task: bean.id,
        title: input.titles[bean.id] ?? bean.id,
        agent: bean.agent,
        phase: bean.phase,
        since: bean.since,
        cells: cells.toSorted((a, b) => a.column - b.column),
      };
    })
    .toSorted((a, b) => slotNumber(a.agent) - slotNumber(b.agent));
}

function recentConflictBeds(
  events: readonly RaceEvent[],
  now: number,
  beds: readonly string[],
): ReadonlySet<string> {
  const hot = new Set<string>();
  for (const event of events) {
    if (
      event.type === 'merge.conflict' &&
      event.t <= now &&
      event.t > now - CONFLICT_WINDOW_SECONDS
    )
      for (const path of event.files) hot.add(bedOf(path, beds));
  }
  return hot;
}

function slotNumber(slot: SlotId | null): number {
  return slot === null ? Number.MAX_SAFE_INTEGER : Number(slot.slice(1));
}
