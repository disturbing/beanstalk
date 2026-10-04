import { z } from 'zod';

import { TaskId } from './ids';
import { ArenaTask } from './task';

/**
 * Integration policies (plan §6): `beanstalk-v2` is the product, `queue` the baseline. The
 * earlier beanstalk variants are named so a run config can say them; this build runs only
 * `queue` and `beanstalk-v2`.
 */
export const PolicyName = z.enum(['queue', 'beanstalk', 'beanstalk-preland', 'beanstalk-v2']);
export type PolicyName = z.infer<typeof PolicyName>;

/** The agent adapter the driver runs (`replay` applies reference patches; free). */
export const AgentKind = z.enum(['claude', 'codex', 'replay']);
export type AgentKind = z.infer<typeof AgentKind>;

/** A footprint the driver predicted for a task before the race (the harness's intake step). */
export const TaskFootprint = z.strictObject({
  method: z.string().max(40),
  selected: z.array(z.string().max(200)).max(50),
  probs: z.record(z.string().max(200), z.number().min(0).max(1)),
});
export type TaskFootprint = z.infer<typeof TaskFootprint>;

/**
 * Body of `POST /v1/runs`: the harness's `RaceConfig` (same names and defaults) plus the
 * tasks themselves. Fields that only the driver uses (model, max turns, timeouts) are
 * carried so every instruction states them and the events record them.
 */
export const RunConfig = z
  .strictObject({
    policy: PolicyName,
    agent: AgentKind.default('replay'),
    model: z.string().max(100).nullable().default(null),
    agents: z.number().int().min(1).max(64).default(4),
    ci_seconds: z.number().min(0).max(3600).default(60),
    ci_slots: z.number().int().min(1).max(16).default(2),
    batch: z.number().int().min(1).max(64).default(4),
    batch_wait: z.number().min(0).max(3600).default(0),
    budget_usd: z.number().positive().max(10_000).default(25),
    max_invocation_usd: z.number().positive().max(1000).default(3),
    max_turns: z.number().int().min(1).max(1000).default(40),
    agent_timeout: z.number().positive().max(86_400).default(900),
    seed: z.number().int().default(0),
    /** Open reds that pause new starts; v2 has no error-budget controller (it runs as 999). */
    error_budget: z.number().int().min(0).max(1000).optional(),
    /** Where tasks fork from; the policy decides when absent (v2: the sprout head). */
    snapshot: z.enum(['green', 'head']).optional(),
    merge_drivers: z.enum(['auto', 'union', 'none']).default('auto'),
    queue_hold: z.boolean().default(true),
    /** Which acceptance tests are restored before commits; v2 protects landed ones. */
    protect_tests: z.enum(['own', 'landed']).optional(),
    /** v2: pre-land checks run in parallel and land optimistically, or inside the turn. */
    preland_mode: z.enum(['optimistic', 'locked']).default('optimistic'),
    /** v2: emulated latency of a pre-land check; null means `ci_seconds` (the fair setting). */
    preland_seconds: z.number().min(0).max(3600).nullable().default(null),
    /** v2: how long the race's oracle takes to answer a decision card (emulated human). */
    decision_seconds: z
      .number()
      .min(0)
      .max(24 * 3600)
      .default(30),
    /** v2: who wins a decision card when nobody answers it: the landed spec, the arriving one, or wait. */
    decision_oracle: z.enum(['landed', 'arriving', 'none']).default('landed'),
    /** v2: who answers a card: the oracle after `decision_seconds`, or a human (the decision route). */
    decision_mode: z.enum(['oracle', 'human']).default('oracle'),
    /** v2, human mode: seconds after which the oracle answers instead; null waits for the human. */
    human_timeout_seconds: z
      .number()
      .positive()
      .max(7 * 24 * 3600)
      .nullable()
      .default(null),
    /**
     * v2: what a decision does. `reexecute` (E6): the winner stays landed, a test author amends
     * the loser's acceptance tests to the decided spec and the loser is re-executed (or, when
     * the arriving bean wins, the landed loser's tests are amended in place). `decline` (v2.0):
     * the arriving bean is dropped.
     */
    decision_outcome: z.enum(['reexecute', 'decline']).default('reexecute'),
    /**
     * v2: whether a bean whose check passed on a sprout that has since moved is checked again
     * when the beans that landed meanwhile share a file with it (`PRELAND_RECHECK`). `adaptive`
     * (v2.2) skips that re-check while recent pre-land reds are rare.
     */
    recheck: z.enum(['file', 'never', 'hunk', 'adaptive']).default('adaptive'),
    /** v2: what `adaptive` does once pre-land reds appear (`PRELAND_ADAPT_FALLBACK`). */
    recheck_fallback: z.enum(['file', 'hunk']).default('file'),
    /** v2: free the agent while its bean is checked; reworks resume its session on a free slot. */
    release_on_check: z.boolean().optional(),
    /** v2: re-run a red validation before revert-first; revert only if the same test file fails again. */
    flake_confirm: z.boolean().default(true),
    /**
     * v2 (E6): a pre-land red whose failing tests already failed in a validation of the sprout
     * it was checked on (no green validation or revert since) is the sprout's, not the bean's.
     * The bean waits for the sprout to move and checks again without spending a rework round
     * (at most 3 times).
     */
    inherited_reds: z.boolean().default(true),
    max_rework: z.number().int().min(0).max(20).default(3),
    max_fix_attempts: z.number().int().min(1).max(20).default(2),
    max_wall_minutes: z
      .number()
      .positive()
      .max(24 * 60)
      .default(360),
    infra_retry_seconds: z.number().min(0).max(600).default(10),
    rework_resume: z.boolean().default(true),
    shuffle: z.boolean().default(false),
    label: z.string().max(200).nullable().default(null),
    arena: z.string().max(200).default('arena'),
    arena_digest: z.string().max(64).default(''),
    footprint: z.string().max(40).default('none'),
    footprint_threshold: z.number().min(0).max(1).default(0.3),
    footprints: z.record(TaskId, TaskFootprint).default({}),
    tasks: z.array(ArenaTask).min(1).max(200),
  })
  .superRefine((config, issues) => {
    const ids = config.tasks.map((task) => task.id);
    if (new Set(ids).size !== ids.length) {
      issues.addIssue({ code: 'custom', path: ['tasks'], message: 'task ids must be unique' });
    }
    if (config.policy === 'beanstalk-v2' && config.protect_tests === 'own') {
      issues.addIssue({
        code: 'custom',
        path: ['protect_tests'],
        message: 'v2 protects landed acceptance tests',
      });
    }
    if (config.policy === 'beanstalk-v2' && config.snapshot === 'green') {
      issues.addIssue({
        code: 'custom',
        path: ['snapshot'],
        message: 'v2 starts tasks from the sprout head',
      });
    }
    if (
      config.policy === 'beanstalk-v2' &&
      config.error_budget !== undefined &&
      config.error_budget !== V2_ERROR_BUDGET
    ) {
      issues.addIssue({
        code: 'custom',
        path: ['error_budget'],
        message: 'v2 has no error-budget controller; leave error_budget unset',
      });
    }
    const known = new Set<string>(ids);
    for (const id of Object.keys(config.footprints)) {
      if (!known.has(id)) {
        issues.addIssue({ code: 'custom', path: ['footprints', id], message: 'unknown task id' });
      }
    }
  });
export type RunConfig = z.infer<typeof RunConfig>;
export type RunConfigInput = z.input<typeof RunConfig>;

/** The harness default for `--error-budget`, and what v2 runs with (`--error-budget 999`). */
const DEFAULT_ERROR_BUDGET = 3;
const V2_ERROR_BUDGET = 999;

/** `--error-budget` as the run reports it: v2 runs without the controller (999). */
export function errorBudget(config: Pick<RunConfig, 'policy' | 'error_budget'>): number {
  if (config.policy === 'beanstalk-v2') return V2_ERROR_BUDGET;
  return config.error_budget ?? DEFAULT_ERROR_BUDGET;
}

/** Which acceptance tests the driver restores before a commit (`--protect-tests`). */
export function protectTestsMode(
  config: Pick<RunConfig, 'policy' | 'protect_tests'>,
): 'own' | 'landed' {
  return config.protect_tests ?? (config.policy === 'beanstalk-v2' ? 'landed' : 'own');
}

/** Where a task forks from (`--snapshot`): v2 always starts from the sprout head (`head`). */
export function snapshotMode(config: Pick<RunConfig, 'policy' | 'snapshot'>): 'green' | 'head' {
  return config.snapshot ?? (config.policy === 'beanstalk-v2' ? 'head' : 'green');
}

/** Whether an agent is freed while its bean is checked (E5): on by default for v2. */
export function releasesOnCheck(config: Pick<RunConfig, 'policy' | 'release_on_check'>): boolean {
  return config.release_on_check ?? config.policy === 'beanstalk-v2';
}

/** v2's pre-land check latency: `preland_seconds`, or the CI latency when unset. */
export function prelandSeconds(config: Pick<RunConfig, 'preland_seconds' | 'ci_seconds'>): number {
  return config.preland_seconds ?? config.ci_seconds;
}

/** The harness's `RaceConfig.union()`: CHANGELOG files merge with `merge=union`. */
export function usesUnionMerge(config: Pick<RunConfig, 'merge_drivers' | 'policy'>): boolean {
  if (config.merge_drivers === 'auto') return config.policy !== 'queue';
  return config.merge_drivers === 'union';
}

/** The `.git/info/attributes` patterns the harness writes when the union driver is on. */
export const UNION_PATTERNS: readonly string[] = [
  'CHANGELOG.md',
  'CHANGELOG*.md',
  '**/CHANGELOG.md',
];

/** Paths (git attribute patterns) that merge with the union driver in this run. */
export function unionPaths(config: Pick<RunConfig, 'merge_drivers' | 'policy'>): readonly string[] {
  return usesUnionMerge(config) ? UNION_PATTERNS : [];
}
