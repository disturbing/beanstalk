/**
 * t032's tail (the real races `cf-v25dep-sonnet-12-s7`, `-s11`): a bean whose own test two
 * landed beans break together, so no rule can make it green. Shared by the tail fix's and
 * parking's simulator tests.
 */
import type { RunConfigInput } from '@gitstalk/shared-race/run-config';

import type { FailRule } from './fake-world';
import type { RaceScenario } from './scenario';
import { soloTask } from './scenario';

/** Landed beans whose files t032's own test reads too: the search's decoys. */
export const DECOYS = ['t040', 't041', 't042', 't043', 't044', 't045', 't046', 't047'];
const DECOY_READS = DECOYS.map((id) => `src/${id}/index.ts`);

/**
 * t032 of `cf-v25dep-sonnet-12-s7` and `-s11`: its shipping clashes with t005 (t005's own test
 * pins the old total, and the confirmation email of t032's test shows t005's separators) and
 * with t030's free-shipping threshold (t032's test expects shipping on a $100 order). Two
 * landed beans break t032's own test together, so leaving either out fixes nothing and no
 * dynamic culprit is ever confirmed. Neither clash can be reconciled, the card keeps t005,
 * and the loser stays red under every re-execution: the race looped until its 60-minute cap.
 */
const T032_RULES: readonly FailRule[] = [
  {
    markers: ['impl:t005', 'impl:t032'],
    file: 'tests/t005.test.ts',
    name: 'leaves small orders unchanged',
    reads: ['src/t005/index.ts', 'src/t032/index.ts'],
  },
  {
    markers: ['impl:t005', 'impl:t032'],
    file: 'tests/t032.test.ts',
    name: 'shows the new total in the confirmation email',
    reads: ['src/t005/index.ts', 'src/t032/index.ts', ...DECOY_READS],
  },
  {
    markers: ['impl:t030', 'impl:t032'],
    file: 'tests/t032.test.ts',
    name: 'includes shipping on top of goods and tax',
    reads: ['src/t030/index.ts', 'src/t032/index.ts', ...DECOY_READS],
  },
];

export function t032Loop(config: Partial<RunConfigInput> = {}): RaceScenario {
  return {
    tasks: [
      soloTask('t005'),
      soloTask('t030'),
      ...DECOYS.map((id) => soloTask(id)),
      soloTask('t032', { stubborn: true }),
    ],
    rules: T032_RULES,
    durations: {
      t005: 10_000,
      t030: 12_000,
      ...Object.fromEntries(DECOYS.map((id, index) => [id, 14_000 + index * 1_000])),
      t032: 100_000,
    },
    config,
  };
}
