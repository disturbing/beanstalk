import { describe, expect, it } from 'vitest';

import { recordedRun } from '../recorded/recorded-runs';
import { codeMap, mapFiles, moduleOf } from './code-map';
import { reduceRace } from '@gitstalk/shared-ask/race/reduce-race';

function v2Events() {
  const recorded = recordedRun('j6boaclinn');
  if (recorded === undefined) throw new Error('fixture missing');
  return recorded.events;
}

describe('the code map', () => {
  it('groups files by module under src, with root files last', () => {
    expect(
      ['src/billing/tax.ts', 'src/db/migrations/0001_x.ts', 'src/app.ts', 'README.md'].map(
        moduleOf,
      ),
    ).toEqual(['billing', 'db', 'src', 'root']);
  });

  it('keeps every module and file in place as the race goes on', () => {
    const events = v2Events();
    const files = mapFiles(['README.md', 'src/app.ts'], events);
    const layout = (count: number) => {
      const state = reduceRace(events.slice(0, count));
      return codeMap({
        files,
        state,
        events: events.slice(0, count),
        now: state.clock,
      }).modules.map(
        (module) => `${module.name}:${module.files.map((file) => file.path).join(',')}`,
      );
    };
    expect(layout(200)).toEqual(layout(events.length));
  });

  it('flags files that two beans in flight touch at once', () => {
    const events = v2Events();
    const at = events.findIndex((event) => event.t > 240);
    const state = reduceRace(events.slice(0, at));
    const map = codeMap({
      files: mapFiles([], events),
      state,
      events: events.slice(0, at),
      now: state.clock,
    });
    expect(map.overlaps.length).toBeGreaterThan(0);
    for (const overlap of map.overlaps) {
      expect(overlap.beans.length).toBeGreaterThan(1);
      for (const bean of overlap.beans) expect(state.beans[bean]?.files).toContain(overlap.path);
    }
  });

  it('is cold at the end of the race: nothing in flight, no overlaps', () => {
    const events = v2Events();
    const state = reduceRace(events);
    const map = codeMap({ files: mapFiles([], events), state, events, now: state.clock });
    expect(map.overlaps).toEqual([]);
    expect(map.hottest).toBe(0);
  });
});
