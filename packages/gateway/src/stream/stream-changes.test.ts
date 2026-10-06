import { describe, expect, it } from 'vitest';

import type { EmittedEvent } from '../engine/model';
import { streamChanges } from './stream-changes';

function start(inv: string, kind: string, task: string): EmittedEvent {
  return {
    seq: 1,
    t: 12.5,
    ts: '2026-10-06T00:00:12.500+00:00',
    type: 'invocation.start',
    inv,
    kind,
    task,
    agent: 'a0',
    adapter: 'replay',
    model: null,
    attempt: 1,
    resume: null,
    cwd: `work/agents/${task}`,
    budget_cap_usd: 1,
  };
}

function end(inv: string, kind: string, task: string): EmittedEvent {
  return {
    seq: 2,
    t: 13,
    ts: '2026-10-06T00:00:13.000+00:00',
    type: 'invocation.end',
    inv,
    kind,
    task,
    agent: 'a2',
    ok: false,
    killed: true,
    cost_usd: 0,
    cost_source: 'none',
    spent_usd: 0,
  };
}

describe('streamChanges', () => {
  it('opens and closes only the streaming kinds, with the slot from the open invocation', () => {
    const events = [
      start('i1', 'initial', 't001'),
      start('i2', 'reconcile', 't002'),
      end('i0', 'rework', 't003'),
      end('i9', 'review', 't004'),
    ];

    const changes = streamChanges(events, { i1: { slot: 'a7' } }, 60_000);

    expect(changes).toEqual({
      opens: [{ inv: 'i1', task: 't001', slot: 'a7', kind: 'initial', t: 12.5, ttlMs: 60_000 }],
      closes: [{ inv: 'i0', task: 't003', t: 13 }],
    });
  });

  it('falls back to the event agent when the invocation is no longer open', () => {
    const changes = streamChanges([start('i1', 'fixer', 't001')], {}, 1);

    expect(changes.opens.map((open) => open.slot)).toEqual(['a0']);
  });

  it('reports nothing for a step without invocation events', () => {
    expect(streamChanges([], {}, 1)).toEqual({ opens: [], closes: [] });
  });
});
