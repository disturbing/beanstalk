import { describe, expect, it } from 'vitest';

import { Sha } from '@gitstalk/shared-race/ids';
import { RunConfig } from '@gitstalk/shared-race/run-config';

import { engineEnv } from '../engine/catalog';
import { step } from '../engine/engine';
import { initialEngineState } from '../engine/lifecycle';
import type { EngineInput } from '../engine/model';
import type { EngineState } from '../engine/state';
import { agentResult } from '../engine/testing/fake-world';
import type { StepWrite } from './step-writes';
import { classifyStep, stepFingerprint } from './step-writes';

const T0 = Date.UTC(2026, 9, 6, 12, 0, 0);

function envFor(policy: 'queue' | 'beanstalk-v2'): ReturnType<typeof engineEnv> {
  return engineEnv(
    RunConfig.parse({
      policy,
      agents: 3,
      tasks: [
        {
          id: 't001',
          title: 'One',
          prompt: 'Do one.',
          acceptance_tests: { 'tests/t001.test.ts': 'x' },
        },
      ],
    }),
  );
}

/** Applies inputs as the RunDO does and lists what each step had to write. */
function writes(policy: 'queue' | 'beanstalk-v2', inputs: readonly EngineInput[]): StepWrite[] {
  const env = envFor(policy);
  let state: EngineState = initialEngineState(env, T0);
  return inputs.map((input) => {
    const output = step(state, input, env);
    const before = state;
    state = output.state;
    return classifyStep(input, output, () => stepFingerprint(before)).write;
  });
}

const at = (seconds: number): number => T0 + seconds * 1000;

const race: readonly EngineInput[] = [
  {
    kind: 'start',
    at: at(1),
    baseSha: Sha.parse('a'.repeat(40)),
    labels: { out: 'x', repo: 'race-x' },
  },
  { kind: 'poll', at: at(2), slot: 'a0', pollId: 'p1' },
  { kind: 'poll', at: at(3), slot: 'a1', pollId: 'p2' },
  { kind: 'poll', at: at(4), slot: 'a1', pollId: 'p3' },
  { kind: 'poll-expired', at: at(5), slot: 'a1', pollId: 'p3' },
  { kind: 'poll-expired', at: at(6), slot: 'a2', pollId: 'gone' },
  { kind: 'progress', at: at(7), slot: 'a0', inv: 'inv0001-initial', costUsd: 0.2 },
  {
    kind: 'result',
    at: at(8),
    slot: 'a0',
    inv: 'inv0001-initial',
    result: agentResult({ ok: true, head_sha: Sha.parse('b'.repeat(40)), session_id: 's1' }),
  },
];

describe('which steps the RunDO writes', () => {
  it.each(['queue', 'beanstalk-v2'] as const)(
    'keeps %s poll bookkeeping and cost estimates out of storage',
    (policy) => {
      expect(writes(policy, race)).toEqual([
        'state', // start
        'state', // a0's poll receives t001
        'none', // a1 asks: nothing to give
        'none', // a1 asks again: the first poll is answered wait
        'none', // a1's poll expires
        'none', // an unknown poll expires
        'cost', // a0's running estimate
        'state', // a0's result
      ]);
    },
  );

  it('writes a poll that starts work', () => {
    const [, delivered] = writes('queue', race.slice(0, 2));

    expect(delivered).toBe('state');
  });
});
