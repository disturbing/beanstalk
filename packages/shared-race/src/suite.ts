import { z } from 'zod';

/**
 * A run's test suite: what every check runs (pre-land, validation, re-checks, confirm runs,
 * targeted checks, the final check) and what agents are told about running the tests. The
 * designed arena runs a bare `node --test`; a real-task arena (`research/real-arena/<name>/
 * arena.json`) names its test globs, Node options, environment and dependency snapshot, and the
 * driver sends them here (`research/race/harness/remote.py`, `suite_config`), so both forges
 * run the same suite and send the same prompts.
 *
 * The argv goes to the runner as a list and is never handed to a shell; the runner adds its
 * reporters after `node` and refuses anything that does not run `node`.
 */

/** The harness's default hint (`research/race/harness/suite.py`, `DEFAULT_HINT`). */
export const DEFAULT_TEST_HINT = 'Run `node --test`.';

/** Variables the runner owns; a run may not set them for its suite (`packages/gateway/container`). */
const REFUSED_ENV_NAMES: readonly string[] = ['PATH', 'HOME', 'CI'];
const REFUSED_ENV_PREFIXES: readonly string[] = ['GIT_', 'LD_', 'NODE_TEST', 'BWRAP'];
const MAX_ENV_VARS = 32;

const hasNoNul = (text: string): boolean => !text.includes('\0');

const SuiteArg = z.string().min(1).max(500).refine(hasNoNul, 'must not contain NUL');

/** `node`, its options, `--test` and the test files or globs. */
const SuiteArgv = z
  .array(SuiteArg)
  .min(2)
  .max(64)
  .refine((argv) => argv[0] === 'node', 'must run node (the runner reads its junit reporter)')
  .refine((argv) => argv.includes('--test'), 'must run node --test');

const EnvName = z
  .string()
  .regex(/^[A-Z_][A-Z0-9_]{0,63}$/, 'must be an upper-case variable name')
  .refine(
    (name) =>
      !REFUSED_ENV_NAMES.includes(name) &&
      !REFUSED_ENV_PREFIXES.some((prefix) => name.startsWith(prefix)),
    "is the runner's own",
  );

const SuiteEnv = z
  .record(EnvName, z.string().max(4000).refine(hasNoNul, 'must not contain NUL'))
  .refine((env) => Object.keys(env).length <= MAX_ENV_VARS, `at most ${MAX_ENV_VARS} variables`);

/** A dependency snapshot baked into the runner image (`/opt/arena-deps/<name>`). */
const DepsName = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/, 'must be a snapshot name');

export const RunSuite = z.strictObject({
  /** The whole suite: `node [options] --test [globs]` (arena.json `node_args`, `test_args`). */
  argv: SuiteArgv.default(['node', '--test']),
  /** Chosen test files: this argv with the files appended (targeted checks, confirm runs). */
  files_argv: SuiteArgv.default(['node', '--test']),
  /** Extra environment for every suite run (arena.json `env`). */
  env: SuiteEnv.default({}),
  /** The runner image's dependency snapshot, linked above the checkout; null: none. */
  deps: DepsName.nullable().default(null),
  /** The whole suite run's limit; a suite still running then is a red, timed-out check. */
  timeout_seconds: z.number().positive().max(3600).default(300),
  /** The sentence agents are told about running the tests (arena.json `agent_test_hint`). */
  test_hint: z.string().min(1).max(2000).default(DEFAULT_TEST_HINT),
});
export type RunSuite = z.infer<typeof RunSuite>;

/** The designed arena's suite: a bare `node --test`, no environment, no dependencies. */
export const DEFAULT_SUITE: RunSuite = RunSuite.parse({});

/**
 * The suite command as the harness's prompts write it (`SuiteConfig.command`): a bare
 * `node --test` stays bare; otherwise the argv joined by spaces, globs with `*` in quotes.
 */
export function suiteCommand(suite: Pick<RunSuite, 'argv'>): string {
  return suite.argv.map((arg) => (arg.includes('*') ? `'${arg}'` : arg)).join(' ');
}

/** The command that runs chosen test files, for prompts (`node --test a.test.js b.test.js`). */
export function filesCommand(
  suite: Pick<RunSuite, 'files_argv'>,
  files: readonly string[],
): string {
  return [...suite.files_argv, ...files].join(' ');
}
