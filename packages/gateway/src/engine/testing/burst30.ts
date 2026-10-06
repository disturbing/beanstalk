/**
 * The 30-agent post-mortem race (`cf-demo-sonnet-30-s7`, `docs/claude-opus/11`) as a
 * scenario: the arena's 40 tasks with their real predicted modules, its declared couplings
 * and card pairs, one genuine contradiction that parks (t023 against t012), and the break
 * that stalled the real race: two migrations numbered alike (t010 and t011 there) that each
 * pass alone, land together without a re-check (disjoint files) and fail the whole suite, new
 * tests included. No migration reverts cleanly (later beans edited the migration index), and
 * one bean (t026) fixes the numbering forward when its tree has the clash.
 *
 * Calibration (`cf-demo-sonnet-30-s7`): initial runs 15-45 s (real median 18 s), CI and
 * pre-land checks about 75 s, the migrations ready at about 6 minutes so two land side by side
 * at about 7 (real: t010 at 8.3), t026 committing after the break (real: 9.5). Under the v2.5
 * `demo` preset, seed 7 at 30 agents: the break lands at 7.1 min, both tickets find a culprit
 * whose revert conflicts, the sprout stays red until t026's fix lands (green again at 16.6),
 * 30th green 16.6, 35th 28.0, done 31.6, 37 green and 3 parked (real: 28.0, 34.5, 42.9, 36 and
 * 2 parked). Billing beans late in the order start late (t039 at about 30 minutes).
 *
 * `burst30Scenario(seed, agents, config)` is the scenario; `breakNumbers` and `redEpisodes`
 * measure it (`v2-burst30.test.ts`).
 */
import type { RunConfigInput } from '@beanstalk/shared-race/run-config';

import type { FailRule, ScriptedTask } from './fake-world';
import type { RaceRun, RaceScenario } from './scenario';
import { eventsOf, soloTask } from './scenario';

/** Each task's predicted module in the real race (`footprint.predicted`). */
const MODULES: Readonly<Record<string, string>> = {
  t001: 'orders',
  t002: 'orders',
  t003: 'billing',
  t004: 'billing',
  t005: 'lib',
  t006: 'billing',
  t007: 'orders',
  t008: 'inventory',
  t009: 'orders',
  t010: 'db',
  t011: 'orders',
  t012: 'auth',
  t013: 'notifications',
  t014: 'auth',
  t015: 'billing',
  t016: 'billing',
  t017: 'orders',
  t018: 'orders',
  t019: 'cart',
  t020: 'auth',
  t021: 'db',
  t022: 'billing',
  t023: 'billing',
  t024: 'db',
  t025: 'notifications',
  t026: 'billing',
  t027: 'db',
  t028: 'orders',
  t029: 'cart',
  t030: 'cart',
  t031: 'billing',
  t032: 'billing',
  t033: 'shipping',
  t034: 'inventory',
  t035: 'cart',
  t036: 'billing',
  t037: 'db',
  t038: 'cart',
  t039: 'billing',
  t040: 'db',
};

/** The real race's start cards: the later task declares a semantic coupling with the earlier. */
const CARD_PAIRS = [
  { first: 't002', later: 't022', test: 'src/billing/invoice-list.test.ts' },
  { first: 't011', later: 't018', test: 'src/notifications/tracking-email.test.ts' },
  { first: 't005', later: 't031', test: 'src/billing/invoice-text.test.ts' },
  { first: 't028', later: 't032', test: 'src/shipping/signature.test.ts' },
] as const;

/**
 * The beans that add a database migration (t007, t010, t011 and t028 did in the race): any two
 * that do not see each other number theirs alike. t026 renumbers them forward.
 */
export const MIGRATIONS = ['t007', 't010', 't011', 't028'] as const;
const FIXER = 't026';
const MIGRATION_INDEX = 'src/db/migrations/index.ts';
const MIGRATION_MILLIS = 360_000;
/** t026 committed at 9.5 minutes, after the break landed, as in the race. */
const FIXER_MILLIS = 480_000;

const TASK_IDS = Object.keys(MODULES);
const MODULE_TESTS = [...new Set(Object.values(MODULES))].map(
  (name) => `src/${name}/${name}.test.ts`,
);

function implementation(id: string, markers: readonly string[]): string {
  return `export const ${id} = 1; // impl:${id}${markers.map((marker) => ` ${marker}`).join('')}\n`;
}

function arenaTask(id: string): ScriptedTask {
  const markers: string[] = [];
  const pair = CARD_PAIRS.find(({ first, later }) => first === id || later === id);
  if (pair !== undefined) markers.push(`clash:${id}`);
  if ((MIGRATIONS as readonly string[]).includes(id)) markers.push(`mig:${id}`);
  const writes: Record<string, string> = { [`src/${id}/index.ts`]: implementation(id, markers) };
  if (id === FIXER) writes[MIGRATION_INDEX] = `export const migrations = ['0001'];\n// ${id}\n`;
  const clean = { [`src/${id}/index.ts`]: implementation(id, []) };
  return soloTask(id, {
    writes,
    ...(pair === undefined ? {} : { reexecutions: [clean] }),
    ...(pair?.later === id ? { coupledWith: [pair.first] } : {}),
    ...((MIGRATIONS as readonly string[]).includes(id) ? { revertConflicts: true } : {}),
    // t026 renumbers every migration it finds; a migration's author renumbers its own when
    // told it collides (a rework), never in its first run.
    ...(id === FIXER ? { fixes: MIGRATIONS.map((task) => `mig:${task}`) } : {}),
    ...((MIGRATIONS as readonly string[]).includes(id) ? { fixes: [`mig:${id}`] } : {}),
    ...(id === 't023' ? { stubborn: true } : {}),
  });
}

/** Two migrations numbered alike fail the whole suite: every module test and every task's test. */
const MIGRATION_RULES: readonly FailRule[] = MIGRATIONS.flatMap((first, index) =>
  MIGRATIONS.slice(index + 1).flatMap((second) =>
    [...MODULE_TESTS, ...TASK_IDS.map((id) => `tests/${id}.test.ts`)].map((file) => ({
      markers: [`mig:${first}`, `mig:${second}`],
      file,
      name: `migration ${first} and ${second} share a number`,
      reads: [MIGRATION_INDEX, `src/${first}/index.ts`, `src/${second}/index.ts`],
      requiresFile: true,
    })),
  ),
);

const RULES: readonly FailRule[] = [
  ...CARD_PAIRS.map(({ first, later, test }) => ({
    markers: [`clash:${first}`, `clash:${later}`],
    file: test,
    name: `${first} and ${later} together`,
    reads: [`src/${first}/index.ts`, `src/${later}/index.ts`],
  })),
  {
    markers: ['impl:t012', 'impl:t023'],
    file: 'tests/t023.test.ts',
    name: 'the tax line keeps its session-based rate',
    reads: ['src/t012/index.ts', 'src/t023/index.ts'],
  },
  ...MIGRATION_RULES,
];

const BASE_FILES: Readonly<Record<string, string>> = {
  'README.md': 'arena\n',
  [MIGRATION_INDEX]: `export const migrations = ['0001'];\n`,
  ...Object.fromEntries(
    [...MODULE_TESTS, ...CARD_PAIRS.map(({ test }) => test)].map((test) => [
      test,
      `test('${test}');\n`,
    ]),
  ),
};

/**
 * Initial runs of 15-45 s spread by the seed (the real race's median was 18 s, p90 30 s).
 * The migrations take 6 minutes each (t010 reached its last green check at 8.3 minutes after
 * two conflict reworks), so two of them are checked side by side late in the burst, as there.
 */
function durations(seed: number): Record<string, number> {
  return Object.fromEntries(
    TASK_IDS.map((id, index) => {
      const spread = (index * 7_919 + seed * 104_729) % 30_000;
      if ((MIGRATIONS as readonly string[]).includes(id)) return [id, MIGRATION_MILLIS];
      return [id, id === FIXER ? FIXER_MILLIS : 15_000 + spread];
    }),
  );
}

/** The arena race with the migration break, for `agents` agents (the real races ran 12 and 30). */
export function burst30Scenario(
  seed: number,
  agents: number,
  config: Partial<RunConfigInput> = {},
): RaceScenario {
  const tasks = TASK_IDS.map(arenaTask);
  return {
    tasks,
    rules: RULES,
    baseFiles: BASE_FILES,
    seed,
    durations: durations(seed),
    config: {
      policy: 'beanstalk-v2',
      agents,
      // A CI run took 75 s in the race (median of 43: 60 s emulated latency plus the suite on a
      // standard-2 runner); pre-land checks 77 s. The simulated suite adds 1.5 s.
      ci_seconds: 73.5,
      ci_slots: 2,
      // The real races' wall cap.
      max_wall_minutes: 60,
      footprints: Object.fromEntries(
        TASK_IDS.map((id) => [
          id,
          { method: 'predictor', selected: [`src/${MODULES[id] ?? 'src'}`], probs: {} },
        ]),
      ),
      ...config,
    },
  };
}

/** One row of the post-mortem tables: the kth greens, start to green, last green, done. */
export type BreakNumbers = {
  readonly green: number;
  readonly parked: number;
  readonly dropped: number;
  readonly kth: Readonly<Record<20 | 25 | 30 | 35, number | null>>;
  readonly start_to_green_median: number | null;
  readonly start_to_green_p90: number | null;
  readonly last_green: number | null;
  readonly done: number;
  readonly red_validations: number;
  readonly correct: boolean;
};

function minutes(seconds: number): number {
  return Math.round((seconds / 60) * 100) / 100;
}

function quantile(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[index] ?? null;
}

export function breakNumbers(run: RaceRun): BreakNumbers {
  const tasks = Object.values(run.state.tasks);
  const greens = tasks
    .flatMap((task) => (task.greenAt === null ? [] : [task.greenAt]))
    .toSorted((a, b) => a - b);
  const starts = new Map(
    eventsOf(run.events, 'task.start').map((event) => [String(event['task']), event.t]),
  );
  const startToGreen = tasks
    .flatMap((task) => {
      const started = starts.get(task.id);
      return task.greenAt === null || started === undefined ? [] : [task.greenAt - started];
    })
    .toSorted((a, b) => a - b);
  const kth = (k: number): number | null => {
    const at = greens[k - 1];
    return at === undefined ? null : minutes(at);
  };
  const atMinutes = (value: number | null): number | null =>
    value === null ? null : minutes(value);
  return {
    green: greens.length,
    parked: tasks.filter((task) => task.status === 'parked').length,
    dropped: tasks.filter((task) => task.status === 'dropped').length,
    kth: { 20: kth(20), 25: kth(25), 30: kth(30), 35: kth(35) },
    start_to_green_median: atMinutes(quantile(startToGreen, 0.5)),
    start_to_green_p90: atMinutes(quantile(startToGreen, 0.9)),
    last_green: atMinutes(greens.at(-1) ?? null),
    done: minutes(eventsOf(run.events, 'race.end')[0]?.t ?? 0),
    red_validations: eventsOf(run.events, 'ci.end', { purpose: 'validate', green: false }).length,
    correct: eventsOf(run.events, 'final.check')[0]?.['correct'] === true,
  };
}

/** A stretch of the race with the sprout known red: a red validation until the next promotion. */
export type RedEpisode = { readonly from: number; readonly to: number | null };

/** The red episodes, in minutes: from each first red validation to the next green promotion. */
export function redEpisodes(run: RaceRun): RedEpisode[] {
  const episodes: RedEpisode[] = [];
  let from: number | null = null;
  for (const event of run.events) {
    const isRed =
      event.type === 'ci.end' && event['purpose'] === 'validate' && event['green'] === false;
    if (isRed && from === null) from = event.t;
    if (event.type === 'green.promote' && from !== null) {
      episodes.push({ from: minutes(from), to: minutes(event.t) });
      from = null;
    }
  }
  if (from !== null) episodes.push({ from: minutes(from), to: null });
  return episodes;
}
