import { describe, expect, it } from 'vitest';

import { RepoEventsMessage } from '@beanstalk/shared-race/repo-events';

import { activityLine } from './activity-text';
import { repoEventsOf } from './map-events';
import { messagesOf } from './publisher';

const TS = '2026-10-07T12:00:00.000+00:00';

function row(seq: number, fields: Record<string, unknown>) {
  return { seq, body: JSON.stringify({ seq, t: seq, ts: TS, ...fields }) };
}

const pushed = (bean: string) =>
  bean === 'add-total' ? { title: 'Add a total helper', actor: 'coop' } : null;

describe('repository events from the engine log', () => {
  it('maps a bean from push to the stalk, with who pushed it', () => {
    const events = repoEventsOf(
      [
        row(1, { type: 'race.start', policy: 'beanstalk-v2' }),
        row(2, { type: 'task.start', task: 'add-total', agent: 'a0', base: 'x' }),
        row(3, {
          type: 'land',
          task: 'add-total',
          ticket: null,
          kind: 'task',
          sha: 'b'.repeat(40),
          target: 'trunk',
          trunk_idx: 1,
          files: ['src/total.ts', 'test/total.test.ts'],
        }),
        row(4, { type: 'green.promote', sha: 'b'.repeat(40), trunk_idx: 1, tasks: ['add-total'] }),
      ],
      pushed,
    );
    expect(events).toEqual([
      {
        seq: 2,
        at: TS,
        kind: 'bean.opened',
        bean: 'add-total',
        title: 'Add a total helper',
        actor: 'coop',
      },
      {
        seq: 3,
        at: TS,
        kind: 'bean.landed',
        bean: 'add-total',
        sha: 'b'.repeat(40),
        trunk_idx: 1,
        files: 2,
        actor: 'coop',
      },
      {
        seq: 4,
        at: TS,
        kind: 'stalk.promoted',
        sha: 'b'.repeat(40),
        trunk_idx: 1,
        beans: ['add-total'],
      },
    ]);
    expect(events.map((event) => activityLine(event).text)).toEqual([
      '@coop pushed bean add-total: Add a total helper.',
      'add-total landed on the sprout at bbbbbbb, green on the merged tree (2 files).',
      'The stalk moved to bbbbbbb: add-total validated.',
    ]);
  });

  it('maps reverts, reds, reworks, endings and decisions', () => {
    const events = repoEventsOf(
      [
        row(5, {
          type: 'ticket.open',
          ticket: 'k1',
          red_sha: 'c'.repeat(40),
          red_idx: 2,
          failing: ['t1'],
        }),
        row(6, {
          type: 'revert',
          ticket: 'k1',
          task: 'b2',
          reverted: 'c'.repeat(40),
          sha: 'd'.repeat(40),
          trunk_idx: 3,
        }),
        row(7, { type: 'rework.start', task: 'b2', reason: 'red', attempt: 1, resumed: false }),
        row(8, { type: 'task.parked', task: 'b3', reason: 'needs a decision' }),
        row(9, {
          type: 'decision.request',
          card: 'c1',
          task: 'b3',
          against: ['b1'],
          specs: {},
          failing: [],
          attempts: 1,
        }),
        row(10, {
          type: 'decision.made',
          card: 'c1',
          winner: 'b3',
          loser: 'b1',
          oracle: 'human:dana',
          wait_seconds: 3,
        }),
      ],
      () => null,
    );
    expect(events.map((event) => event.kind)).toEqual([
      'sprout.red',
      'bean.reverted',
      'bean.rework',
      'bean.ended',
      'decision.asked',
      'decision.made',
    ]);
    const decided = events.at(-1);
    if (decided === undefined) throw new Error('no decision');
    expect(activityLine(decided).text).toBe('Decided: b3 over b1, by @dana.');
  });

  it('skips rows it cannot read, and landings that are not a bean’s own', () => {
    const events = repoEventsOf(
      [
        { seq: 1, body: 'not json' },
        row(2, {
          type: 'land',
          task: null,
          ticket: 'k1',
          kind: 'fix',
          sha: 'e'.repeat(40),
          target: 'trunk',
          trunk_idx: 4,
          files: [],
        }),
        row(3, { type: 'green.promote' }),
      ],
      () => null,
    );
    expect(events).toEqual([]);
  });

  it('caps long lists so every message passes the schema', () => {
    const failing = Array.from({ length: 80 }, (_, index) => `test-${index}-${'x'.repeat(300)}`);
    const events = repoEventsOf(
      [row(1, { type: 'ticket.open', ticket: 'k', red_sha: 'f'.repeat(40), red_idx: 1, failing })],
      () => null,
    );
    const many = Array.from({ length: 120 }, () => events[0]).filter(
      (event) => event !== undefined,
    );
    const messages = messagesOf('r0123456789abcdef012', many);
    expect(messages.map((message) => message.events.length)).toEqual([50, 50, 20]);
    for (const message of messages) expect(RepoEventsMessage.safeParse(message).success).toBe(true);
  });
});
