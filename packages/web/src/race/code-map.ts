/**
 * The code map: modules and files in a stable grid, heated by the beans in flight that
 * touch each file now, with overlaps (two or more beans in flight on one file) called out.
 * The layout depends only on the file list, so it never moves while the race runs.
 */
import type { TaskId } from '@gitstalk/shared-race/ids';

import { compareText } from '@gitstalk/shared-ask/repo/paths';
import { isInFlight } from '@gitstalk/shared-ask/race/race-counters';
import type { RaceEvent } from '@gitstalk/shared-ask/race/race-events';
import type { RaceState } from '@gitstalk/shared-ask/race/race-state';

/** A landing or a conflict glows on the map for this long (race seconds). */
export const AFTERGLOW_SECONDS = 45;

export type CodeMapFile = {
  readonly path: string;
  readonly name: string;
  /** Beans in flight that touch the file now. */
  readonly beans: readonly TaskId[];
  readonly landedRecently: boolean;
  readonly conflictedRecently: boolean;
};

export type CodeMapModule = { readonly name: string; readonly files: readonly CodeMapFile[] };

export type Overlap = { readonly path: string; readonly beans: readonly TaskId[] };

export type CodeMap = {
  readonly modules: readonly CodeMapModule[];
  readonly overlaps: readonly Overlap[];
  readonly hottest: number;
};

/** Every file the map should hold: a base listing plus whatever the events touch. */
export function mapFiles(base: readonly string[], events: readonly RaceEvent[]): readonly string[] {
  const files = new Set(base);
  for (const event of events) {
    if (event.type === 'task.commit' || event.type === 'land' || event.type === 'merge.conflict') {
      for (const path of event.files) files.add(path);
    }
  }
  return [...files].toSorted(compareText);
}

/** Groups files into modules: `src/<module>/…`, `src` itself, and the repo root. */
export function moduleOf(path: string): string {
  const parts = path.split('/');
  if (parts.length === 1) return 'root';
  if (parts[0] === 'src' && parts.length > 2) return parts[1] ?? 'src';
  return parts[0] ?? 'root';
}

export function codeMap(input: {
  readonly files: readonly string[];
  readonly state: RaceState;
  readonly events: readonly RaceEvent[];
  readonly now: number;
}): CodeMap {
  const touching = touchingNow(input.state);
  const landed = recentFiles(input.events, input.now, 'land');
  const conflicted = recentFiles(input.events, input.now, 'merge.conflict');
  const byModule = new Map<string, CodeMapFile[]>();
  for (const path of input.files) {
    const module = moduleOf(path);
    const files = byModule.get(module) ?? [];
    files.push({
      path,
      name: path.slice(path.lastIndexOf('/') + 1),
      beans: touching.get(path) ?? [],
      landedRecently: landed.has(path),
      conflictedRecently: conflicted.has(path),
    });
    byModule.set(module, files);
  }
  const modules = [...byModule]
    .map(([name, files]) => ({ name, files }))
    .toSorted(
      (a, b) =>
        Number(a.name === 'root') - Number(b.name === 'root') || compareText(a.name, b.name),
    );
  const overlaps = [...touching]
    .filter(([, beans]) => beans.length > 1)
    .map(([path, beans]) => ({ path, beans }))
    .toSorted((a, b) => b.beans.length - a.beans.length || compareText(a.path, b.path));
  const hottest = Math.max(0, ...[...touching.values()].map((beans) => beans.length));
  return { modules, overlaps, hottest };
}

/** File → beans in flight that touch it. */
function touchingNow(state: RaceState): ReadonlyMap<string, readonly TaskId[]> {
  const touching = new Map<string, TaskId[]>();
  for (const bean of Object.values(state.beans)) {
    if (!isInFlight(bean.phase)) continue;
    for (const path of bean.files) touching.set(path, [...(touching.get(path) ?? []), bean.id]);
  }
  return touching;
}

function recentFiles(
  events: readonly RaceEvent[],
  now: number,
  type: 'land' | 'merge.conflict',
): ReadonlySet<string> {
  const files = new Set<string>();
  for (const event of events) {
    if (event.t > now || event.t < now - AFTERGLOW_SECONDS) continue;
    if (event.type === type) for (const path of event.files) files.add(path);
  }
  return files;
}
