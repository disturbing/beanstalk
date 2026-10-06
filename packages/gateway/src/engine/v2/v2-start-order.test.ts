import { describe, expect, it } from 'vitest';

import type { RunConfigInput } from '@beanstalk/shared-race/run-config';
import { V25_RULES_OFF } from '@beanstalk/shared-race/run-config';

import type { FailRule, ScriptedTask } from '../testing/fake-world';
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
  /** When 85% of the tasks were green (the 170th of 200 in E4's shape). */
  readonly green85Minutes: number;
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
    green85Minutes: (greens[Math.ceil(tasks.length * 0.85) - 1] ?? Number.POSITIVE_INFINITY) / 60,
  };
}

/**
 * E4's shape at half size, so `pnpm check` stays fast: 100 tasks, 32 agents. The full 200
 * tasks on 64 agents takes about 30 s to simulate; its numbers are in the README.
 */
const HALF_CHAINS = [10, 8, 6, 5, 4, 4, 3, 3, 2, 2, 2, 2];
const HALF: ChainShape = { chains: HALF_CHAINS, total: 100 };
const HALF_AGENTS: Partial<RunConfigInput> = { agents: 32 };

describe('dependency-aware starts on dependency chains', () => {
  // A deterministic but CPU-heavy simulation: about 2 s quiet, more under load, so it gets room.
  it(
    'keeps every chained bean that fifo drops under v2.4, at about fifo’s pace',
    { timeout: 30_000 },
    () => {
      const v24 = { ...V25_RULES_OFF, ...HALF_AGENTS };
      const fifo = chainNumbers(runRace(chainScenario(v24, HALF)));
      const run = runRace(chainScenario({ ...v24, ...DEPENDENCY }, HALF));
      const dependency = chainNumbers(run);

      expect(wellFormedProblems(run.events)).toEqual([]);
      expect(fifo.dropped).toBeGreaterThan(0);
      expect(dependency).toMatchObject({ green: 100, dropped: 0 });
      expect(dependency.conflicts).toBeLessThan(fifo.conflicts * 0.7);
      expect(dependency.green85Minutes).toBeLessThan(fifo.green85Minutes * 1.15);
    },
  );

  it(
    'under the v2.5 defaults (rescue keeps fifo’s beans) still cuts the conflicts',
    { timeout: 30_000 },
    () => {
      const fifo = chainNumbers(runRace(chainScenario(HALF_AGENTS, HALF)));
      const dependency = chainNumbers(
        runRace(chainScenario({ ...HALF_AGENTS, ...DEPENDENCY }, HALF)),
      );

      expect(fifo).toMatchObject({ green: 100, dropped: 0 });
      expect(dependency).toMatchObject({ green: 100, dropped: 0 });
      expect(dependency.conflicts).toBeLessThan(fifo.conflicts * 0.7);
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

/** t002 and t001 are fine alone; together they fail a module test that reads both. */
const MODULE_CLASH: FailRule = {
  markers: ['impl:t001', 'impl:t002'],
  file: 'src/shared/both.test.ts',
  name: 'both features together',
  reads: ['src/t001/index.ts', 'src/t002/index.ts'],
};

/**
 * F's gap: dependency starts put a bean after its declared partner, so the partner is already
 * in the bean's base when they clash, in a test neither owns. One agent, bound to its bean.
 */
function partnerInBase(config: Partial<RunConfigInput>): RaceScenario {
  return {
    tasks: [soloTask('t001'), soloTask('t002', { coupledWith: ['t001'] })],
    rules: [MODULE_CLASH],
    config: {
      policy: 'beanstalk-v2',
      agents: 1,
      ci_seconds: 60,
      release_on_check: false,
      ...DEPENDENCY,
      ...config,
    },
  };
}

function t002Culprits(run: RaceRun): unknown[] {
  return eventsOf(run.events, 'rework.start', { task: 't002', reason: 'preland-red' }).map(
    (event) => event['culprits'],
  );
}

describe('a declared partner already in the bean’s base (F’s culprit gap)', () => {
  it('v2.4 names no culprit: the partner landed before the bean’s base', () => {
    const run = runRace(partnerInBase(V25_RULES_OFF));

    expect(run.state.tasks['t002']?.baseSha).toBe(
      eventsOf(run.events, 'land', { task: 't001' })[0]?.['sha'],
    );
    expect(t002Culprits(run)[0]).toEqual([]);
  });

  it('base culprits name it by the failing test’s read set', () => {
    const run = runRace(partnerInBase({ ...V25_RULES_OFF, base_culprits: true }));

    expect(t002Culprits(run)[0]).toEqual(['t001']);
  });

  it('v2.5 raises the pair’s start card first, and any later red still names the partner', () => {
    const run = runRace(partnerInBase({}));

    expect(eventsOf(run.events, 'decision.request')[0]).toMatchObject({
      task: 't002',
      against: ['t001'],
      trigger: 'start',
    });
    for (const culprits of t002Culprits(run)) expect(culprits).toEqual(['t001']);
  });
});
