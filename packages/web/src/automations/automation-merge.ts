/**
 * The builder's three-way merge (doc 25 §7.13): when the file changed on the latest landed
 * commit since the editor opened it, base (what the editor opened), theirs (what landed) and
 * ours (the draft) are compared field by field on the parsed structure. A field only one side
 * changed takes that side; a field both changed the same way is agreed; a field both changed
 * differently is a conflict for the person to pick or edit. The merged text is theirs with our
 * changes written into it, so their comments and order are kept.
 */
import { parse } from 'yaml';

import type { FieldPath } from './automation-draft';
import { onEntries, readDraft, setField } from './automation-draft';

/** Mappings merged one key deeper: each trigger and each permission is its own field. */
const NESTED = new Set(['on', 'permissions']);

export type FieldConflict = {
  readonly path: FieldPath;
  /** Each side's value (undefined: absent on that side). */
  readonly base: unknown;
  readonly theirs: unknown;
  readonly ours: unknown;
};

export type MergeOutcome =
  /** Every change merged: `text` is ready to save. */
  | {
      readonly kind: 'merged';
      readonly text: string;
      readonly theirChanges: readonly FieldPath[];
      readonly ourChanges: readonly FieldPath[];
    }
  /** Fields both sides changed differently; `resolve` writes the person's picks. */
  | {
      readonly kind: 'conflict';
      readonly conflicts: readonly FieldConflict[];
      readonly theirChanges: readonly FieldPath[];
      readonly ourChanges: readonly FieldPath[];
    }
  /** Someone deleted the file; the draft can recreate it or be dropped. */
  | { readonly kind: 'deleted'; readonly oursChanged: boolean }
  /** A side does not parse: the person picks a whole version (or edits the YAML). */
  | { readonly kind: 'unparsed' };

/** A conflict's answer: one side, or an edited value (YAML text). */
export type Pick =
  | { readonly kind: 'theirs' }
  | { readonly kind: 'ours' }
  | { readonly kind: 'edited'; readonly yaml: string };

/** Merges the draft (`ours`) with the landed file (`theirs`, null when deleted) over `base`. */
export function mergeAutomation(input: {
  readonly base: string | null;
  readonly theirs: string | null;
  readonly ours: string;
}): MergeOutcome {
  const base = input.base === null ? new Map<string, Field>() : fieldsOf(input.base);
  const ours = fieldsOf(input.ours);
  if (base === null || ours === null) return { kind: 'unparsed' };
  if (input.base === null && input.theirs === null)
    // A new file absent on both sides: nothing landed meanwhile, so the draft is the merge.
    return {
      kind: 'merged',
      text: input.ours,
      theirChanges: [],
      ourChanges: [...ours.values()].map((field) => field.path),
    };
  if (input.theirs === null)
    return { kind: 'deleted', oursChanged: changedKeys(base, ours).length > 0 };
  const theirs = fieldsOf(input.theirs);
  if (theirs === null) return { kind: 'unparsed' };
  const theirChanged = new Set(changedKeys(base, theirs));
  const ourChanged = changedKeys(base, ours);
  const conflicts = ourChanged
    .filter((key) => theirChanged.has(key) && encode(theirs.get(key)) !== encode(ours.get(key)))
    .map((key) => conflictOf(key, { base, theirs, ours }));
  const theirChanges = [...theirChanged].map(pathOf);
  const ourChanges = ourChanged.filter((key) => !theirChanged.has(key)).map(pathOf);
  if (conflicts.length > 0) return { kind: 'conflict', conflicts, theirChanges, ourChanges };
  return {
    kind: 'merged',
    text: applyFields(input.theirs, ours, ourChanges),
    theirChanges,
    ourChanges,
  };
}

/**
 * The merged text once the person picked each conflict: theirs, our non-conflicting changes,
 * and each pick. An edited value that is not YAML is an error for that field.
 */
export function resolveMerge(input: {
  readonly theirs: string;
  readonly ours: string;
  readonly ourChanges: readonly FieldPath[];
  readonly conflicts: readonly FieldConflict[];
  readonly picks: ReadonlyMap<string, Pick>;
}): { readonly ok: true; readonly text: string } | { readonly ok: false; readonly field: string } {
  const ours = fieldsOf(input.ours);
  if (ours === null) return { ok: false, field: '(file)' };
  let text = applyFields(input.theirs, ours, input.ourChanges);
  for (const conflict of input.conflicts) {
    const key = keyOf(conflict.path);
    const pick = input.picks.get(key) ?? { kind: 'ours' };
    const value = pickedValue(pick, conflict);
    if (value === INVALID) return { ok: false, field: key };
    if (pick.kind !== 'theirs') text = setField(text, conflict.path, value);
  }
  return { ok: true, text };
}

/** A field path as people read it: `on.schedule`, `prompt`. */
export function keyOf(path: FieldPath): string {
  return path.join('.');
}

// Fields ------------------------------------------------------------------------------------

type Field = { readonly path: FieldPath; readonly value: unknown };

/** Every mergeable field of a text, by key; null when the text does not parse. */
function fieldsOf(text: string): Map<string, Field> | null {
  const parsed = readDraft(text);
  if (parsed.kind !== 'ok') return null;
  const fields = new Map<string, Field>();
  for (const [key, value] of Object.entries(parsed.value)) {
    if (!NESTED.has(key)) {
      fields.set(key, { path: [key], value });
      continue;
    }
    const entries = key === 'on' ? onEntries(value) : entriesOf(value);
    for (const [inner, innerValue] of entries)
      fields.set(`${key}.${inner}`, { path: [key, inner], value: innerValue ?? null });
  }
  return fields;
}

function changedKeys(base: ReadonlyMap<string, Field>, side: ReadonlyMap<string, Field>): string[] {
  const keys = new Set([...base.keys(), ...side.keys()]);
  return [...keys].filter((key) => encode(base.get(key)) !== encode(side.get(key)));
}

function conflictOf(
  key: string,
  sides: Readonly<Record<'base' | 'theirs' | 'ours', ReadonlyMap<string, Field>>>,
): FieldConflict {
  return {
    path: pathOf(key),
    base: sides.base.get(key)?.value,
    theirs: sides.theirs.get(key)?.value,
    ours: sides.ours.get(key)?.value,
  };
}

/** `theirs` with each of `paths` set to our value (or removed, where we removed it). */
function applyFields(
  theirs: string,
  ours: ReadonlyMap<string, Field>,
  paths: readonly FieldPath[],
) {
  return paths.reduce((text, path) => setField(text, path, ours.get(keyOf(path))?.value), theirs);
}

const INVALID = Symbol('invalid');

function pickedValue(pick: Pick, conflict: FieldConflict): unknown {
  switch (pick.kind) {
    case 'theirs':
      return conflict.theirs;
    case 'ours':
      return conflict.ours;
    case 'edited':
      try {
        return parse(pick.yaml) ?? null;
      } catch {
        return INVALID;
      }
    default:
      return pick satisfies never;
  }
}

function pathOf(key: string): FieldPath {
  const [head = key, ...rest] = key.split('.');
  return NESTED.has(head) && rest.length > 0 ? [head, rest.join('.')] : [key];
}

/** A field's value compared by its JSON (absent and null differ). */
function encode(field: Field | undefined): string {
  return field === undefined ? '∅' : JSON.stringify(field.value ?? null);
}

function entriesOf(value: unknown): readonly (readonly [string, unknown])[] {
  return isRecord(value) ? Object.entries(value) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
