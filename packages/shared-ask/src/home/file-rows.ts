/**
 * The Files explorer's rows, woven with beans: each entry of a directory with the last bean
 * that landed on it (and where that bean sits: sprout or stalk) and the beans in flight that
 * are changing it now.
 */
import type { SlotId, TaskId } from '@gitstalk/shared-race/ids';

import { isInFlight } from '../race/race-counters';
import type { RaceState } from '../race/race-state';
import type { LeafStatus } from './stalk';

export type LastBean = {
  readonly task: TaskId | null;
  readonly idx: number;
  readonly t: number;
  readonly status: LeafStatus;
};

export type FlyingBean = { readonly task: TaskId; readonly slot: SlotId | null };

export type FileRow = {
  readonly path: string;
  readonly name: string;
  readonly dir: boolean;
  readonly last: LastBean | null;
  readonly flying: readonly FlyingBean[];
};

export type DirListing = { readonly rows: readonly FileRow[]; readonly unchanged: number };

/** The entries of `dir` (folders first). With `changedOnly`, untouched files collapse into a count. */
export function dirListing(input: {
  readonly paths: readonly string[];
  readonly state: RaceState;
  readonly now: number;
  readonly dir: string;
  readonly changedOnly: boolean;
}): DirListing {
  const entries = entriesOf(input.paths, input.dir);
  const rows = entries.map((entry) => rowFor(entry, input.state, input.now));
  if (!input.changedOnly) return { rows, unchanged: 0 };
  const shown = rows.filter((row) => row.dir || row.last !== null || row.flying.length > 0);
  return { rows: shown, unchanged: rows.length - shown.length };
}

/** A list of files (an answer's), each with its last bean and beans in flight. */
export function fileRows(
  paths: readonly string[],
  state: RaceState,
  now: number,
): readonly FileRow[] {
  return paths.map((path) => rowFor({ path, dir: false }, state, now));
}

function entriesOf(
  paths: readonly string[],
  dir: string,
): readonly { path: string; dir: boolean }[] {
  const prefix = dir === '' ? '' : `${dir}/`;
  const dirs = new Set<string>();
  const files: string[] = [];
  for (const path of paths) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash === -1) files.push(path);
    else dirs.add(prefix + rest.slice(0, slash));
  }
  return [
    ...[...dirs].toSorted().map((path) => ({ path, dir: true })),
    ...files.toSorted().map((path) => ({ path, dir: false })),
  ];
}

function rowFor(entry: { path: string; dir: boolean }, state: RaceState, now: number): FileRow {
  const covers = (file: string): boolean =>
    entry.dir ? file.startsWith(`${entry.path}/`) : file === entry.path;
  const landing = state.line.commits
    .filter((commit) => commit.t <= now && commit.files.some(covers))
    .toSorted((a, b) => b.idx - a.idx)[0];
  const culprits = new Set(
    state.tickets.flatMap((ticket) => (ticket.culprit === null ? [] : [ticket.culprit])),
  );
  const flying = Object.values(state.beans)
    .filter((bean) => isInFlight(bean.phase) && bean.startedAt !== null && bean.files.some(covers))
    .map((bean) => ({ task: bean.id, slot: bean.agent }));
  return {
    path: entry.path,
    name: entry.path.split('/').at(-1) ?? entry.path,
    dir: entry.dir,
    last:
      landing === undefined
        ? null
        : {
            task: landing.task,
            idx: landing.idx,
            t: landing.t,
            status: lastStatus(
              landing.task !== null && culprits.has(landing.task),
              landing.idx <= state.line.stalkIdx,
            ),
          },
    flying,
  };
}

function lastStatus(red: boolean, onStalk: boolean): LeafStatus {
  if (red) return 'red';
  return onStalk ? 'stalk' : 'sprout';
}
