import { describe, expect, it } from 'vitest';

import type { RunConfigInput } from '@beanstalk/shared-race/run-config';

import type { ScriptedTask } from '../testing/fake-world';
import type { RaceRun, RaceScenario } from '../testing/scenario';
import { eventsOf, runRace, soloTask, wellFormedProblems } from '../testing/scenario';
import { ageBound } from './v2-start-order';

/**
 * Dependency-aware starts on a synthetic repo with dependency chains (E4's binding
 * constraint). The 40-task burst comparison lives in `v2-burst.test.ts`.
 */
const DEPENDENCY: Partial<RunConfigInput> = { start_order: 'dependency' };

/** Chain lengths of the synthetic repo: a few long chains, many short ones; then singletons. */
const CHAINS = [20, 15, 12, 10, 8, 8, 6, 6, 5, 5, 4, 4, 3, 3, 3, 2, 2, 2, 2, 2];
const SYNTHETIC_TASKS = 200;
/** A 200-task race takes seconds to simulate; vitest's default timeout is 5 s. */
const LONG_RACE_MS = 120_000;

/** A seeded linear congruential generator in [0, 1). */
function lcg(seed: number): () => number {
  const state = { value: seed };
  return () => {
    state.value = (Math.imul(state.value, 1_103_515_245) + 12_345) >>> 0;
    return state.value / 2 ** 32;
  };
}

function taskIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `t${String(index + 1).padStart(3, '0')}`);
}

/** Chain names in history order: chains interleaved at random, keeping each chain's order. */
function interleave(chains: readonly number[], total: number, random: () => number): string[] {
  const queues = chains.map((length, chain) => Array.from({ length }, () => `chain${chain}`));
  const singletons = total - chains.reduce((sum, length) => sum + length, 0);
  queues.push(...Array.from({ length: singletons }, () => ['solo']));
  const slots: string[] = [];
  while (queues.some((queue) => queue.length > 0)) {
    const open = queues.filter((queue) => queue.length > 0);
    const next = open[Math.floor(random() * open.length)]?.shift();
    if (next !== undefined) slots.push(next);
  }
  return slots;
}

type ChainShape = { chains?: readonly number[]; total?: number; seed?: number };

/**
 * Tasks in history order: chain members append to their chain's hot file, so a member
 * started before its predecessor landed conflicts with it. Agents work 2-10 minutes; the
 * footprints are predicted perfectly.
 */
export function chainScenario(
  config: Partial<RunConfigInput>,
  shape: ChainShape = {},
): RaceScenario {
  const { chains = CHAINS, total = SYNTHETIC_TASKS, seed = 11 } = shape;
  const random = lcg(seed);
  const slots = interleave(chains, total, random);
  const ids = taskIds(total);
  const chainOf = (index: number): string => slots[index] ?? 'solo';
  const tasks: ScriptedTask[] = ids.map((id, index) =>
    chainOf(index) === 'solo'
      ? soloTask(id)
      : soloTask(id, { appends: { [`src/${chainOf(index)}/log.ts`]: `entry ${id}` } }),
  );
  const footprints = Object.fromEntries(
    ids.map((id, index) => {
      const own = `src/${id}`;
      const selected = chainOf(index) === 'solo' ? [own] : [own, `src/${chainOf(index)}`];
      return [id, { method: 'oracle', selected, probs: {} }];
    }),
  );
  const durations = ids.map((id) => [id, 120_000 + Math.floor(random() * 480_000)] as const);
  const logs = chains.map((_, chain) => [`src/chain${chain}/log.ts`, 'log\n'] as const);
  return {
    tasks,
    seed,
    durations: Object.fromEntries(durations),
    baseFiles: { 'README.md': 'arena\n', ...Object.fromEntries(logs) },
    config: {
      policy: 'beanstalk-v2',
      agents: 64,
      ci_seconds: 60,
      ci_slots: 4,
      footprints,
      ...config,
    },
  };
}

type ChainNumbers = {
  readonly green: number;
  readonly dropped: number;
  readonly conflicts: number;
  readonly green170Minutes: number;
};

function chainNumbers(run: RaceRun): ChainNumbers {
  const tasks = Object.values(run.state.tasks);
  const greens = tasks
    .flatMap((task) => (task.greenAt === null ? [] : [task.greenAt]))
    .toSorted((a, b) => a - b);
  return {
    green: greens.length,
    dropped: tasks.filter((task) => task.status === 'dropped').length,
    conflicts: tasks.reduce((sum, task) => sum + task.conflicts, 0),
    green170Minutes: (greens[169] ?? Number.POSITIVE_INFINITY) / 60,
  };
}

describe('dependency-aware starts on dependency chains', () => {
  it(
    'keeps every chained bean that fifo drops, at about fifo’s pace to the 170th green',
    { timeout: LONG_RACE_MS },
    () => {
      const fifo = chainNumbers(runRace(chainScenario({})));
      const run = runRace(chainScenario(DEPENDENCY));
      const dependency = chainNumbers(run);

      expect(wellFormedProblems(run.events)).toEqual([]);
      expect(fifo.dropped).toBeGreaterThanOrEqual(20);
      expect(dependency).toMatchObject({ green: 200, dropped: 0 });
      expect(dependency.conflicts).toBeLessThan(fifo.conflicts * 0.7);
      expect(dependency.green170Minutes).toBeLessThan(fifo.green170Minutes * 1.15);
    },
  );

  it('pipelines a chain at most three beans deep, then waits for a landing', () => {
    const run = runRace(chainScenario({ ...DEPENDENCY, agents: 20 }, { chains: [6], total: 20 }));

    const placements = eventsOf(run.events, 'placement.decision');
    const first = placements.filter((event) => event.t === placements[0]?.t);
    expect(first).toHaveLength(17);
    expect(first.filter((event) => event.rule === 'least-overlap')).toHaveLength(2);
    expect(chainNumbers(run)).toMatchObject({ green: 20, dropped: 0 });
  });

  it('starts an aged task next however much it clashes', () => {
    expect(ageBound(1)).toBe(4);
    expect(ageBound(64)).toBe(128);
    const run = runRace(
      chainScenario({ ...DEPENDENCY, agents: 2 }, { chains: [12], total: 40, seed: 3 }),
    );

    expect(eventsOf(run.events, 'placement.decision', { rule: 'aged' }).length).toBeGreaterThan(0);
    expect(chainNumbers(run).green).toBe(40);
  });
});
