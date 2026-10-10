import { describe, expect, it } from 'vitest';

import { setCrons, setField } from './automation-draft';
import { keyOf, mergeAutomation, resolveMerge } from './automation-merge';

const BASE = `# Fixes red beans.
name: Fix red beans
on:
  bean_red:
  schedule: [{ cron: "0 9 * * 1" }]
max-cost-usd: 0.5
prompt: |
  Fix it.
`;

describe('the three-way merge', () => {
  it('merges disjoint fields: their schedule and our prompt', () => {
    const theirs = setCrons(BASE, ['0 6 * * 1']);
    const ours = setField(BASE, ['prompt'], 'Fix it, then note it.\n');
    const merged = mergeAutomation({ base: BASE, theirs, ours });
    if (merged.kind !== 'merged') throw new Error(`expected merged, got ${merged.kind}`);
    expect(merged.theirChanges.map(keyOf)).toEqual(['on.schedule']);
    expect(merged.ourChanges.map(keyOf)).toEqual(['prompt']);
    expect(merged.text).toContain('0 6 * * 1');
    expect(merged.text).toContain('Fix it, then note it.');
    expect(merged.text).toContain('# Fixes red beans.');
  });

  it('agrees when both sides made the same change', () => {
    const theirs = setField(BASE, ['max-cost-usd'], 1);
    const merged = mergeAutomation({ base: BASE, theirs, ours: theirs });
    expect(merged.kind).toBe('merged');
  });

  it('reports a conflict when both changed the same field, and resolves with the picks', () => {
    const theirs = setField(BASE, ['max-cost-usd'], 1);
    const ours = setField(setField(BASE, ['max-cost-usd'], 2), ['name'], 'Fixer');
    const merged = mergeAutomation({ base: BASE, theirs, ours });
    if (merged.kind !== 'conflict') throw new Error(`expected conflict, got ${merged.kind}`);
    expect(merged.conflicts).toEqual([{ path: ['max-cost-usd'], base: 0.5, theirs: 1, ours: 2 }]);
    const keepTheirs = resolveMerge({
      theirs,
      ours,
      ourChanges: merged.ourChanges,
      conflicts: merged.conflicts,
      picks: new Map([['max-cost-usd', { kind: 'theirs' }]]),
    });
    expect(keepTheirs).toMatchObject({ ok: true });
    if (keepTheirs.ok) {
      expect(keepTheirs.text).toContain('max-cost-usd: 1\n');
      expect(keepTheirs.text).toContain('name: Fixer');
    }
    const edited = resolveMerge({
      theirs,
      ours,
      ourChanges: merged.ourChanges,
      conflicts: merged.conflicts,
      picks: new Map([['max-cost-usd', { kind: 'edited', yaml: '1.5' }]]),
    });
    expect(edited.ok && edited.text.includes('max-cost-usd: 1.5')).toBe(true);
  });

  it('treats each trigger as its own field', () => {
    const theirs = BASE.replace('  bean_red:\n', '  bean_red:\n  bean_landed:\n');
    const ours = setCrons(BASE, ['0 7 * * 1']);
    const merged = mergeAutomation({ base: BASE, theirs, ours });
    if (merged.kind !== 'merged') throw new Error(`expected merged, got ${merged.kind}`);
    expect(merged.text).toContain('bean_landed');
    expect(merged.text).toContain('0 7 * * 1');
  });

  it('says the file was deleted on their side, and whether the draft changed anything', () => {
    expect(mergeAutomation({ base: BASE, theirs: null, ours: BASE })).toEqual({
      kind: 'deleted',
      oursChanged: false,
    });
    const ours = setField(BASE, ['name'], 'Kept');
    expect(mergeAutomation({ base: BASE, theirs: null, ours })).toEqual({
      kind: 'deleted',
      oursChanged: true,
    });
  });

  it('asks for a whole version when a side does not parse', () => {
    expect(mergeAutomation({ base: BASE, theirs: 'on: [', ours: BASE }).kind).toBe('unparsed');
  });

  it('never calls a new file deleted: absent with no base is the draft as it is', () => {
    const merged = mergeAutomation({ base: null, theirs: null, ours: BASE });
    if (merged.kind !== 'merged') throw new Error(`expected merged, got ${merged.kind}`);
    expect(merged.text).toBe(BASE);
    expect(merged.theirChanges).toEqual([]);
  });

  it('merges against a file someone else created meanwhile (no base)', () => {
    const merged = mergeAutomation({ base: null, theirs: BASE, ours: BASE });
    expect(merged.kind).toBe('merged');
  });
});
