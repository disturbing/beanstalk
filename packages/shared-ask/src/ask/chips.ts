/**
 * Answer chips: the parsed question as removable filters. Removing one re-runs the query
 * without it, so the answer stays editable and honest about what was understood.
 */
import { baseName } from '../repo/paths';
import type { Chip } from './answer';
import type { RankedFile } from './resolve-files';
import type { ViewSpec } from './view-spec';

/** File chips shown before the rest collapse into a count. */
export const VISIBLE_FILE_CHIPS = 8;

/** The `x=` values removed so far: whole entities (`feature`) or single files. */
export type Removals = {
  readonly entities: ReadonlySet<'feature' | 'range' | 'agent' | 'bean'>;
  readonly paths: ReadonlySet<string>;
  readonly files: ReadonlySet<string>;
};

export function parseRemovals(values: readonly string[]): Removals {
  const entities = new Set<'feature' | 'range' | 'agent' | 'bean'>();
  const paths = new Set<string>();
  const files = new Set<string>();
  for (const value of values) {
    if (value === 'feature' || value === 'range' || value === 'agent' || value === 'bean') {
      entities.add(value);
    } else if (value.startsWith('path:')) {
      paths.add(value.slice('path:'.length));
    } else if (value.startsWith('file:')) {
      files.add(value.slice('file:'.length));
    }
  }
  return { entities, paths, files };
}

/** The spec without the removed entities. */
export function applyRemovals(spec: ViewSpec, removals: Removals): ViewSpec {
  const { entities } = removals;
  return {
    ...spec,
    entities: {
      feature: entities.has('feature') ? null : spec.entities.feature,
      paths: spec.entities.paths.filter((path) => !removals.paths.has(path)),
      agent: entities.has('agent') ? null : spec.entities.agent,
      bean: entities.has('bean') ? null : spec.entities.bean,
    },
    range: { ...spec.range, minutes: entities.has('range') ? null : spec.range.minutes },
  };
}

/** Chips for the parsed entities and the resolved files that made it into the answer. */
export function chipsFor(
  spec: ViewSpec,
  ranked: readonly RankedFile[],
  shown: readonly string[],
): readonly Chip[] {
  const kept = new Set(shown);
  const fileSet = ranked.filter((file) => kept.has(file.path));
  const chips: Chip[] = [];
  const { entities, range } = spec;
  if (entities.feature !== null)
    chips.push({ id: 'feature', kind: 'feature', label: entities.feature });
  if (entities.bean !== null) chips.push({ id: 'bean', kind: 'bean', label: entities.bean });
  if (entities.agent !== null) chips.push({ id: 'agent', kind: 'agent', label: entities.agent });
  for (const path of entities.paths) chips.push({ id: `path:${path}`, kind: 'path', label: path });
  if (range.minutes !== null)
    chips.push({ id: 'range', kind: 'range', label: rangeLabel(range.minutes) });
  for (const file of fileSet.slice(0, VISIBLE_FILE_CHIPS)) {
    chips.push({ id: `file:${file.path}`, kind: 'file', label: baseName(file.path) });
  }
  return chips;
}

function rangeLabel(minutes: number): string {
  if (minutes % (24 * 60) === 0)
    return minutes === 24 * 60 ? 'last 24 h' : `last ${minutes / 1440} days`;
  if (minutes % 60 === 0) return `last ${minutes / 60} h`;
  return `last ${minutes} min`;
}
