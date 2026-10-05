/**
 * Builders and assertions shared by the engine's race tests.
 */
import { REQUIRED_EVENT_KEYS } from '@beanstalk/shared-race/events';
import type { RaceEventType } from '@beanstalk/shared-race/events';
import type { RunConfigInput } from '@beanstalk/shared-race/run-config';

import type { EngineState } from '../state';
import type { FailRule, FlakeInjector, ScriptedTask, World } from './fake-world';
import { createWorld } from './fake-world';
import type { SimulationOptions, SimulationResult } from './simulator';
import { seededAgentMillis, simulate } from './simulator';

/** A task writing one file of its own module (the fake suite checks `impl:<id>`). */
export function soloTask(id: string, extra: Partial<ScriptedTask> = {}): ScriptedTask {
  return {
    id,
    writes: { [`src/${id}/index.ts`]: `export const ${id} = 1; // impl:${id}\n` },
    ...extra,
  };
}

export type RaceScenario = {
  readonly tasks: readonly ScriptedTask[];
  readonly rules?: readonly FailRule[];
  readonly baseFiles?: Readonly<Record<string, string>>;
  readonly config?: Partial<RunConfigInput>;
  readonly costUsd?: number;
  readonly seed?: number;
  /** Fixed initial-invocation durations (ms) by task; others draw from the seed. */
  readonly durations?: Readonly<Record<string, number>>;
  /** Flaky failures injected into suite runs. */
  readonly flakes?: FlakeInjector;
  /** `live_sync` upper bound: agents adapt to a clash their sync turn merged (`fake-world`). */
  readonly adaptsOnSync?: boolean;
} & Partial<
  Pick<SimulationOptions, 'silentSlots' | 'injections' | 'startAfterMs' | 'lostInvocations'>
>;

/** An event read field by field in assertions (fields differ per type). */
export type LooseEvent = {
  readonly seq: number;
  readonly t: number;
  readonly ts: string;
  readonly type: RaceEventType;
  readonly [key: string]: unknown;
};

export type RaceRun = Omit<SimulationResult, 'events'> & {
  readonly events: readonly LooseEvent[];
  readonly world: World;
  readonly state: EngineState;
};

/** Runs a scripted race on the queue policy (defaults: 2 agents, 2 CI slots, batch 2). */
export function runRace(scenario: RaceScenario): RaceRun {
  const world = createWorld({
    baseFiles: scenario.baseFiles ?? { 'README.md': 'arena\n', 'src/app.ts': 'export {};\n' },
    tasks: scenario.tasks,
    rules: scenario.rules ?? [],
    costUsd: scenario.costUsd ?? 0.01,
    ...(scenario.flakes === undefined ? {} : { flakes: scenario.flakes }),
    ...(scenario.adaptsOnSync === true ? { adaptsOnSync: true } : {}),
  });
  const seed = scenario.seed ?? 1;
  const config: RunConfigInput = {
    policy: 'queue',
    agent: 'replay',
    agents: 2,
    ci_seconds: 60,
    ci_slots: 2,
    batch: 2,
    seed,
    tasks: scenario.tasks.map((task) => ({
      id: task.id,
      title: `Task ${task.id}`,
      prompt: `Implement ${task.id}.`,
      acceptance_tests: { [`tests/${task.id}.test.ts`]: `test('${task.id}');\n` },
      couplings: (task.coupledWith ?? []).map((partner) => ({ with: partner, type: 'semantic' })),
    })),
    ...scenario.config,
  };
  const seeded = seededAgentMillis(seed);
  const durations = scenario.durations ?? {};
  const result = simulate({
    config,
    world,
    agentMillis: (inv, task, kind, attempt) =>
      (kind === 'initial' ? durations[task] : undefined) ?? seeded(inv, task, kind, attempt),
    ...(scenario.silentSlots === undefined ? {} : { silentSlots: scenario.silentSlots }),
    ...(scenario.injections === undefined ? {} : { injections: scenario.injections }),
    ...(scenario.startAfterMs === undefined ? {} : { startAfterMs: scenario.startAfterMs }),
    ...(scenario.lostInvocations === undefined
      ? {}
      : { lostInvocations: scenario.lostInvocations }),
  });
  const events: readonly LooseEvent[] = result.events;
  return { ...result, events, world };
}

/** Events of one type, optionally matching some fields. */
export function eventsOf(
  events: readonly LooseEvent[],
  type: RaceEventType,
  match: Readonly<Record<string, unknown>> = {},
): LooseEvent[] {
  return events.filter(
    (event) =>
      event.type === type && Object.entries(match).every(([key, value]) => event[key] === value),
  );
}

/**
 * The harness's `ZEvents.test_events_are_well_formed`: sequential seq, sorted t, setup
 * first, one start, final check last, required keys, and paired starts and ends.
 */
export function wellFormedProblems(events: readonly LooseEvent[]): string[] {
  const problems: string[] = [];
  events.forEach((event, index) => {
    if (event.seq !== index + 1) problems.push(`seq ${event.seq} at position ${index + 1}`);
    const previous = events[index - 1];
    if (previous !== undefined && previous.t > event.t)
      problems.push(`t goes back at seq ${event.seq}`);
    for (const key of REQUIRED_EVENT_KEYS[event.type] ?? []) {
      if (!(key in event)) problems.push(`${event.type} lacks ${key}`);
    }
  });
  if (events[0]?.type !== 'race.setup') problems.push('first event is not race.setup');
  if (events.at(-1)?.type !== 'final.check') problems.push('last event is not final.check');
  if (eventsOf(events, 'race.start').length !== 1) problems.push('race.start is not logged once');
  const aborted = eventsOf(events, 'abort').length > 0;
  problems.push(...pairing(events, 'invocation.start', 'invocation.end', 'inv', aborted));
  problems.push(...pairing(events, 'ci.start', 'ci.end', 'ci', aborted));
  return problems;
}

function pairing(
  events: readonly LooseEvent[],
  startType: RaceEventType,
  endType: RaceEventType,
  key: string,
  aborted: boolean,
): string[] {
  const ids = (type: RaceEventType): Set<unknown> =>
    new Set(eventsOf(events, type).map((event) => event[key]));
  const starts = ids(startType);
  const ends = ids(endType);
  const unstarted = [...ends].filter((id) => !starts.has(id));
  const unended = aborted ? [] : [...starts].filter((id) => !ends.has(id));
  return [
    ...unstarted.map((id) => `${endType} ${String(id)} without ${startType}`),
    ...unended.map((id) => `${startType} ${String(id)} never ended`),
  ];
}

/** Event types in order, for compact sequence assertions. */
export function typesOf(events: readonly LooseEvent[]): RaceEventType[] {
  return events.map((event) => event.type);
}

/** A string-array field of an event, sorted (fails the test when it is not one). */
export function sortedStrings(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`expected a list of strings, got ${JSON.stringify(value)}`);
  }
  return value.toSorted();
}
