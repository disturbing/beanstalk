import { describe, expect, it } from 'vitest';

import type { RunConfigInput } from '@beanstalk/shared-race/run-config';

import { buildSummary } from '../summary';
import type { FailRule, ScriptedTask } from '../testing/fake-world';
import type { RaceRun, RaceScenario } from '../testing/scenario';
import { eventsOf, runRace, soloTask, wellFormedProblems } from '../testing/scenario';

/**
 * The burst that sank v2.2 in its first real race (cloud run qpucqup50w, seed 7): twelve
 * agents released during their checks produce beans faster than two CI slots validate them,
 * coupled beans land unchecked and turn the sprout red, and innocent beans then spend their
 * rework rounds on reds that are not theirs.
 */
export const V22_RULES: Partial<RunConfigInput> = {
  recheck: 'adaptive',
  window: 'off',
  inherited_reds: 'validation',
  early_tickets: false,
  start_cards: false,
  rescue: false,
  dynamic_culprits: false,
};

const CHANGELOG_BASE = Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join('\n');

/**
 * Four culprits, each fine alone, breaking a module test together with an earlier bean (the
 * real race's failing tests). They start in the first two waves, so they land early in the
 * burst, as t018, t031, t032 and t033 did.
 */
const PAIRS = [
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

/** The E6 rules off: the v2.4 defaults. */
const WITHOUT_E6: Partial<RunConfigInput> = {
  start_cards: false,
  rescue: false,
  dynamic_culprits: false,
};

/** The burst with each coupled pair declared in the tasks' `couplings`, as the arena does. */
function declaredCouplings(scenario: RaceScenario): RaceScenario {
  const partners = new Map<string, string>(PAIRS.map(({ first, culprit }) => [first, culprit]));
  return {
    ...scenario,
    tasks: scenario.tasks.map((task) => {
      const partner = partners.get(task.id);
      return partner === undefined ? task : { ...task, coupledWith: [partner] };
    }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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

describe('the v2.2 burst, in the simulator', () => {
  it('reproduces the failure: v2.2 drops innocent beans on reds that are not theirs', () => {
    const run = runRace(burstScenario(V22_RULES));

    expect(wellFormedProblems(run.events)).toEqual([]);
    const v22 = numbers(run);
    expect(v22.dropped).toBeGreaterThanOrEqual(8);
    expect(v22.preland_still_red).toBeGreaterThanOrEqual(6);
    // Two v2.2 bugs this race found: a red re-run covered by a newer ticket promoted a red
    // commit, and a leave-one-out search lost a probe and never ended.
    expect(v22.correct).toBe(true);
    expect(v22.done_minutes).toBeLessThan(60);
  });

  it('v2.3 keeps the beans: at least 36 green, a correct final check, little speed given back', () => {
    const v22 = numbers(runRace(burstScenario(V22_RULES)));
    const run = runRace(burstScenario());

    expect(wellFormedProblems(run.events)).toEqual([]);
    const v23 = numbers(run);
    expect(v23.green).toBeGreaterThanOrEqual(36);
    expect(v23.correct).toBe(true);
    expect(v23.preland_still_red).toBeLessThanOrEqual(1);
    expect(v23.done_minutes).toBeLessThanOrEqual(v22.done_minutes * 1.25);
  });

  it('v2.3 re-checks overlaps until five come back green in a row, then skips and samples', () => {
    const run = runRace(calmScenario());

    const block = buildSummary(run.state, run.env, run.state.clock)['beanstalk'];
    const count = (key: string): number => {
      const value: unknown = isRecord(block) ? block[key] : null;
      return typeof value === 'number' ? value : -1;
    };
    expect(block).toMatchObject({ preland_recheck_rule: 'sampled' });
    expect(count('preland_rechecks')).toBeGreaterThanOrEqual(5);
    expect(count('preland_skipped_rechecks')).toBeGreaterThan(0);
    expect(eventsOf(run.events, 'preland.check', { green: false })).toEqual([]);
  });

  it('the E6 rules change nothing on the burst', () => {
    const v24 = numbers(runRace(burstScenario(WITHOUT_E6)));

    expect(numbers(runRace(burstScenario()))).toEqual(v24);
  });

  it('declared couplings finish the burst sooner: cards at the first red', () => {
    const declared = numbers(runRace(declaredCouplings(burstScenario())));

    expect(declared.green).toBe(40);
    expect(declared.correct).toBe(true);
    expect(declared.done_minutes).toBeLessThan(19.2);
  });

  it('the rescue keeps v2.2’s beans that were still red after their reworks', () => {
    const rescued = numbers(runRace(burstScenario({ ...V22_RULES, rescue: true })));

    expect(rescued.preland_still_red).toBe(0);
    expect(rescued.green).toBeGreaterThanOrEqual(35);
    expect(rescued.correct).toBe(true);
  });

  it('v2.3 keeps v2.2’s speed on a calm repo', () => {
    const v22 = numbers(runRace(calmScenario(V22_RULES)));
    const v23 = numbers(runRace(calmScenario()));

    expect(v23.green).toBe(40);
    expect(v22.green).toBe(40);
    expect(v23.done_minutes).toBeLessThanOrEqual(v22.done_minutes * 1.15);
  });
});
