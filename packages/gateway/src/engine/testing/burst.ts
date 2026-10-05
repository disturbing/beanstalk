/**
 * The burst and calm races of `v2/v2-burst.test.ts` as scenarios, so other tests and the
 * simulator tables share them, plus seeded and flaky variants and the race numbers.
 *
 * The burst replays the race that sank v2.2 (cloud run qpucqup50w, seed 7): twelve agents
 * released during their checks produce beans faster than two CI slots validate them, coupled
 * beans land unchecked and turn the sprout red, and innocent beans then spend their rework
 * rounds on reds that are not theirs.
 */
import { Sha } from '@beanstalk/shared-race/ids';
import type { RunConfigInput } from '@beanstalk/shared-race/run-config';

import type { FailRule, FlakeInjector, ScriptedTask } from './fake-world';
import type { RaceRun, RaceScenario } from './scenario';
import { eventsOf, soloTask } from './scenario';

const CHANGELOG_BASE = Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join('\n');

/**
 * Four culprits, each fine alone, breaking a module test together with an earlier bean (the
 * real race's failing tests). They start in the first two waves, so they land early in the
 * burst, as t018, t031, t032 and t033 did.
 */
export const PAIRS = [
  { first: 't001', culprit: 't007', test: 'src/billing/invoice-text.test.ts' },
  { first: 't003', culprit: 't010', test: 'src/notifications/tracking-email.test.ts' },
  { first: 't014', culprit: 't019', test: 'src/orders/confirmation-grouping.test.ts' },
  { first: 't016', culprit: 't022', test: 'src/orders/total-with-shipping.test.ts' },
] as const;

/** Beans that also edit the changelog: they overlap without breaking anything. */
const OVERLAPPING = new Set(['t002', 't006', 't011', 't013', 't020', 't024', 't026', 't028']);

/** The tail: beans whose agents take longer, so they are checked once the burst has landed. */
const TAIL_FROM = 25;

function ids(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `t${String(index + 1).padStart(3, '0')}`);
}

function module(id: string, extra = ''): string {
  return `export const ${id} = 1; // impl:${id}${extra}\n`;
}

function changelog(id: string): string {
  return `${CHANGELOG_BASE}\n${id} entry\n`;
}

function burstTask(id: string): ScriptedTask {
  const isCoupled = PAIRS.some((pair) => pair.first === id || pair.culprit === id);
  if (!isCoupled && !OVERLAPPING.has(id)) return soloTask(id);
  const writes = { [`src/${id}/index.ts`]: module(id), 'CHANGELOG.md': changelog(id) };
  if (!isCoupled) return soloTask(id, { writes });
  return soloTask(id, {
    writes: { ...writes, [`src/${id}/index.ts`]: module(id, ` clash:${id}`) },
    // Re-executed under the decided spec, either bean keeps its feature without the clash.
    reexecutions: [writes],
  });
}

const RULES: readonly FailRule[] = PAIRS.map(({ first, culprit, test }) => ({
  markers: [`clash:${first}`, `clash:${culprit}`],
  file: test,
  name: `${first} and ${culprit} together`,
  reads: [`src/${first}/index.ts`, `src/${culprit}/index.ts`],
}));

const BASE_FILES: Readonly<Record<string, string>> = {
  'README.md': 'arena\n',
  'CHANGELOG.md': `${CHANGELOG_BASE}\n`,
  ...Object.fromEntries(PAIRS.map(({ test }) => [test, `test('${test}');\n`])),
};

/**
 * Initial runs of 15-35 s (the real race's median was 17.5 s), spread by the seed; the tail's
 * take 90-210 s.
 */
function shortDurations(tasks: readonly string[]): Record<string, number> {
  return Object.fromEntries(
    tasks.map((id, index) => {
      const spread = (index * 7_919 + 7 * 104_729) % 20_000;
      return [id, index + 1 >= TAIL_FROM ? 90_000 + spread * 6 : 15_000 + spread];
    }),
  );
}

const TWELVE_AGENTS: Partial<RunConfigInput> = {
  policy: 'beanstalk-v2',
  agents: 12,
  ci_seconds: 60,
  ci_slots: 2,
};

export function burstScenario(config: Partial<RunConfigInput> = {}): RaceScenario {
  const tasks = ids(40);
  return {
    tasks: tasks.map(burstTask),
    rules: RULES,
    baseFiles: BASE_FILES,
    seed: 7,
    durations: shortDurations(tasks),
    config: { ...TWELVE_AGENTS, ...config },
  };
}

/** The same race with no coupled beans: overlaps only. */
export function calmScenario(config: Partial<RunConfigInput> = {}): RaceScenario {
  const tasks = ids(40);
  return {
    tasks: tasks.map((id) =>
      OVERLAPPING.has(id)
        ? soloTask(id, {
            writes: { [`src/${id}/index.ts`]: module(id), 'CHANGELOG.md': changelog(id) },
          })
        : soloTask(id),
    ),
    baseFiles: BASE_FILES,
    seed: 7,
    durations: shortDurations(tasks),
    config: { ...TWELVE_AGENTS, ...config },
  };
}

export type RaceNumbers = {
  readonly green: number;
  readonly dropped: number;
  readonly preland_still_red: number;
  readonly reverted: number;
  readonly done_minutes: number;
  readonly green30_minutes: number | null;
  readonly red_validations: number;
  readonly tickets: number;
  readonly rechecks: number;
  readonly correct: boolean;
};

function minutes(seconds: number): number {
  return Math.round((seconds / 60) * 10) / 10;
}

export function numbers(run: RaceRun): RaceNumbers {
  const tasks = Object.values(run.state.tasks);
  const greens = tasks
    .flatMap((task) => (task.greenAt === null ? [] : [task.greenAt]))
    .toSorted((a, b) => a - b);
  const reasons = tasks.flatMap((task) => (task.dropReason === null ? [] : [task.dropReason]));
  const end = eventsOf(run.events, 'race.end')[0];
  const thirtieth = greens[29];
  return {
    green: greens.length,
    dropped: reasons.length,
    preland_still_red: reasons.filter((reason) => reason.startsWith('pre-land check still red'))
      .length,
    reverted: reasons.filter((reason) => reason.startsWith('reverted')).length,
    done_minutes: minutes(end?.t ?? 0),
    green30_minutes: thirtieth === undefined ? null : minutes(thirtieth),
    red_validations: eventsOf(run.events, 'ci.end', { purpose: 'validate', green: false }).length,
    tickets: eventsOf(run.events, 'ticket.open').length,
    rechecks: eventsOf(run.events, 'preland.recheck').length,
    correct: eventsOf(run.events, 'final.check')[0]?.['correct'] === true,
  };
}

/** The four culprits' declared semantic couplings (the arena's `couplings`). */
const DECLARED: Readonly<Record<string, string>> = Object.fromEntries(
  PAIRS.map(({ first, culprit }) => [culprit, first]),
);

/**
 * The burst with its couplings declared and each bean's module predicted; `coarse` also
 * predicts `src` for every bean and `(root)` for every third, as real predictions do.
 */
export function declaredBurst(
  config: Partial<RunConfigInput>,
  footprint: 'exact' | 'coarse' = 'exact',
): RaceScenario {
  const scenario = burstScenario(config);
  const predicted = (id: string, index: number): string[] => {
    if (footprint === 'exact') return [`src/${id}`];
    return index % 3 === 0 ? ['(root)', 'src', `src/${id}`] : ['src', `src/${id}`];
  };
  return {
    ...scenario,
    config: {
      ...scenario.config,
      footprints: Object.fromEntries(
        scenario.tasks.map((task, index) => [
          task.id,
          { method: 'oracle', selected: predicted(task.id, index), probs: {} },
        ]),
      ),
      tasks: scenario.tasks.map((task) => {
        const partner = DECLARED[task.id];
        return {
          id: task.id,
          title: `Task ${task.id}`,
          prompt: `Implement ${task.id}.`,
          acceptance_tests: { [`tests/${task.id}.test.ts`]: `test('${task.id}');\n` },
          couplings: partner === undefined ? [] : [{ with: partner, type: 'semantic' }],
        };
      }),
    },
  };
}

/** The flaky test the injector fails (`flakes`). */
export const FLAKY_TEST = 'tests/flaky.test.ts';

/** A 32-bit FNV-1a hash: the flake injector's deterministic coin. */
function fnv(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** One CI run in twenty, chosen by the seed, the commit, the instance and the run's ordinal. */
export function flakes(seed: number): FlakeInjector {
  return ({ sha, instance, nth }) =>
    fnv(`${seed}:${sha}:${JSON.stringify(instance)}:${nth}`) % 100 < 5
      ? { file: FLAKY_TEST, name: 'sometimes fails' }
      : null;
}

/** The burst with its agent times spread by `seed` (seed 7 is the burst itself). */
export function seededBurst(seed: number, config: Partial<RunConfigInput> = {}): RaceScenario {
  const scenario = burstScenario(config);
  const durations = Object.fromEntries(
    scenario.tasks.map((task, index) => {
      const spread = (index * 7_919 + seed * 104_729) % 20_000;
      return [task.id, index + 1 >= TAIL_FROM ? 90_000 + spread * 6 : 15_000 + spread];
    }),
  );
  return { ...scenario, durations, seed };
}

/**
 * The seeded burst with initial runs five times as long (75-175 s, the tail 450-1050 s), as
 * real agents on larger tasks: a coupled partner often lands while the other bean is still
 * being written, which is where live sprout sync (`live_sync`) can act.
 */
export function longBurst(seed: number, config: Partial<RunConfigInput> = {}): RaceScenario {
  const scenario = seededBurst(seed, config);
  const durations = Object.fromEntries(
    Object.entries(scenario.durations ?? {}).map(([task, millis]) => [task, millis * 5]),
  );
  return { ...scenario, durations };
}

/** The four races of the simulator tables (`docs/claude-opus/11`), by seed. */
export const SEEDED_SCENARIOS: Readonly<
  Record<
    'burst' | 'calm' | 'earlier' | 'flaky',
    (seed: number, config: Partial<RunConfigInput>) => RaceScenario
  >
> = {
  burst: (seed, config) => seededBurst(seed, config),
  calm: (seed, config) => ({
    ...calmScenario(config),
    durations: seededBurst(seed, config).durations ?? {},
    seed,
  }),
  /** Eight agents with seeded agent times (the scenario's own durations dropped). */
  earlier: (seed, config) => {
    const { durations: _durations, ...scenario } = burstScenario({ agents: 8, ...config });
    return { ...scenario, seed };
  },
  /** The seeded burst with one CI run in twenty failing a flaky test. */
  flaky: (seed, config) => ({ ...seededBurst(seed, config), flakes: flakes(seed) }),
};

/**
 * Commits promoted to the stalk that are red without flakes: a re-run fails a test other than
 * the flaky one. The stalk must never hold one.
 */
export function redStalkCommits(run: RaceRun): string[] {
  const promoted = eventsOf(run.events, 'green.promote').map((event) => String(event['sha']));
  return [...new Set(promoted)].filter((sha) => {
    const again = run.world.runJob({
      kind: 'check',
      sha: Sha.parse(sha),
      extraFiles: null,
      instance: { kind: 'ci', slot: 99 },
    });
    if (!again.ok || again.result.kind !== 'check') return true;
    const failing = again.result.check.failingFiles ?? [];
    return failing.some((path) => path !== FLAKY_TEST);
  });
}
