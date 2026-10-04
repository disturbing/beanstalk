import { describe, expect, it } from 'vitest';

import { InvocationResult } from './driver';
import { InvocationId, SlotId } from './ids';

describe('InvocationResult', () => {
  it('accepts InvocationResult.to_event() as the harness writes it, minus the ids', () => {
    const result = InvocationResult.parse({
      inv_id: 'inv0005-initial',
      adapter: 'claude',
      model: 'haiku',
      ok: true,
      subtype: 'success',
      cost_usd: 0.0232,
      cost_source: 'reported',
      num_turns: 6,
      wall_ms: 18096,
      session_id: 'ff540945',
      usage: { input_tokens: 41, output_tokens: 1972 },
      head_sha: '8c55ba92ba5c7d3d35654ef7334168e3ccd79d71',
      files: ['src/lib/money.ts'],
    });

    expect(result).not.toHaveProperty('inv_id');
    expect(result).toMatchObject({ ok: true, num_turns: 6, wall_ms: 18096, tamper: [], notes: [] });
  });

  it('takes the short §4 names when the long ones are absent', () => {
    const result = InvocationResult.parse({ ok: true, turns: 3, wall_seconds: 12.5 });

    expect(result.num_turns).toBe(3);
    expect(result.wall_ms).toBe(12500);
  });

  it('rejects a head that is not a full sha', () => {
    expect(InvocationResult.safeParse({ ok: true, head_sha: 'abc123' }).success).toBe(false);
  });
});

describe('ids', () => {
  it('parses slot and invocation ids into their template types', () => {
    expect(SlotId.parse('a12')).toBe('a12');
    expect(SlotId.safeParse('a012').success).toBe(false);
    expect(InvocationId.parse('inv0007-rework')).toBe('inv0007-rework');
    expect(InvocationId.safeParse('inv7-rework').success).toBe(false);
  });
});
