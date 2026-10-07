import * as fc from 'fast-check';
import { stringify } from 'smol-toml';
import { describe, expect, it } from 'vitest';

import type { ChecksConfig } from './checks-config';
import {
  ALWAYS_PROTECTED,
  CHECKS_PATH,
  describeChecks,
  matchesPattern,
  protectedChanges,
  protectedPatterns,
  readChecksConfig,
  suiteOf,
} from './checks-config';
import { RunSuite } from './suite';

function problems(text: string): readonly string[] {
  const resolution = readChecksConfig(text);
  if (resolution.kind !== 'invalid') throw new Error(`expected invalid, got ${resolution.kind}`);
  return resolution.problems;
}

function config(text: string): ChecksConfig {
  const resolution = readChecksConfig(text);
  if (resolution.kind !== 'valid') throw new Error(`expected valid: ${JSON.stringify(resolution)}`);
  return resolution.config;
}

describe('reading .beanstalk/checks.toml', () => {
  it('says a tree without the file runs no checks', () => {
    expect(readChecksConfig(null)).toEqual({ kind: 'missing' });
    expect(describeChecks({ kind: 'missing' })[0]).toContain('no checks run');
  });

  it('fills in the defaults for an empty file', () => {
    expect(config('')).toEqual({
      image: 'node',
      command: ['node', '--test'],
      env: {},
      timeout_seconds: 300,
      protected_paths: [],
    });
  });

  it('reads every key', () => {
    const text = [
      'image = "node"',
      'command = ["node", "--test", "spec/**/*.spec.mjs"]',
      'timeout_seconds = 90',
      'protected_paths = ["migrations/**", "LICENSE"]',
      '',
      '[env]',
      'TZ = "UTC"',
    ].join('\n');
    expect(config(text)).toEqual({
      image: 'node',
      command: ['node', '--test', 'spec/**/*.spec.mjs'],
      env: { TZ: 'UTC' },
      timeout_seconds: 90,
      protected_paths: ['migrations/**', 'LICENSE'],
    });
  });

  it('names the line and column of a syntax error', () => {
    expect(problems('image = "node"\ntimeout_seconds = = 3\n')).toEqual([
      'line 2, column 19: invalid value',
    ]);
  });

  it('refuses a shell string and says why', () => {
    expect(problems('command = "npm test"')).toEqual([
      'command: must be an argv array such as ["node", "--test"]; it never runs through a shell',
    ]);
  });

  it('refuses a command that does not run node --test', () => {
    expect(problems('command = ["cargo", "test"]')[0]).toMatch(/^command: must start with "node"/);
    expect(problems('command = ["node", "test.js"]')).toEqual(['command: must run node --test']);
  });

  it('refuses an image the runner does not have, naming the one it has', () => {
    expect(problems('image = "rust"')[0]).toMatch(
      /^image: "rust" is not available: the runner image ships Node 25\.8\.1 only/,
    );
  });

  it('suggests the key a misspelling meant', () => {
    expect(problems('comand = ["node", "--test"]')).toEqual([
      'unknown key "comand" (did you mean "command"?)',
    ]);
  });

  it("explains the starter's old [[check]] draft", () => {
    expect(problems('[[check]]\nname = "tests"\ncommand = "npm test"\n')[0]).toMatch(
      /^unknown table \[\[check\]\]: write the keys at the top level/,
    );
  });

  it("refuses the runner's own variables and other bad values, one problem each", () => {
    const text =
      'timeout_seconds = 5000\nprotected_paths = ["/abs", "../up"]\n[env]\nPATH = "/x"\n';
    expect(problems(text)).toEqual([
      'timeout_seconds: must be at most 1800',
      'protected_paths[0]: is relative to the repository root: drop the /',
      'protected_paths[1]: must not contain .. (paths are inside the repository)',
      "env.PATH: is the runner's own (PATH, HOME, CI, GIT_*, LD_*, NODE_TEST*, BWRAP* are refused)",
    ]);
  });

  it('turns a valid config into the suite the runner runs', () => {
    const suite = suiteOf(
      config('command = ["node", "--no-warnings", "--test", "--test-concurrency=1", "spec/"]'),
    );
    expect(suite).toEqual({
      argv: ['node', '--no-warnings', '--test', '--test-concurrency=1', 'spec/'],
      files_argv: ['node', '--no-warnings', '--test', '--test-concurrency=1'],
      env: {},
      deps: null,
      timeout_seconds: 300,
      test_hint: 'Run `node --no-warnings --test --test-concurrency=1 spec/`.',
    });
    expect(RunSuite.parse(suite)).toEqual(suite);
  });

  it('always protects the checks themselves', () => {
    expect(protectedPatterns({ kind: 'missing' })).toEqual(ALWAYS_PROTECTED);
    expect(
      protectedChanges([CHECKS_PATH, 'src/a.ts'], protectedPatterns({ kind: 'missing' })),
    ).toEqual([CHECKS_PATH]);
  });
});

describe('protected-path patterns', () => {
  it.each([
    ['migrations/0001.sql', 'migrations/**', true],
    ['migrations/a/b.sql', 'migrations/', true],
    ['migrations', 'migrations/**', true],
    ['src/migrations/x.sql', 'migrations/**', false],
    ['src/migrations/x.sql', '**/migrations/*.sql', true],
    ['db/schema.sql', '*.sql', false],
    ['schema.sql', '*.sql', true],
    ['LICENSE', 'LICENSE', true],
    ['LICENSE.md', 'LICENSE', false],
    ['a.b', 'a?b', true],
  ])('%s against %s is %s', (path, pattern, expected) => {
    expect(matchesPattern(path, pattern)).toBe(expected);
  });
});

const SEGMENT = fc.stringMatching(/^[a-z0-9_-][a-z0-9_.-]{0,11}$/);
const PATH = fc.array(SEGMENT, { minLength: 1, maxLength: 5 }).map((parts) => parts.join('/'));
const ARG = fc.stringMatching(/^[A-Za-z0-9_./=*-]{1,20}$/);
const ENV_NAME = fc
  .stringMatching(/^[A-Z][A-Z0-9_]{0,15}$/)
  .filter((name) => !['PATH', 'HOME', 'CI'].includes(name))
  .filter((name) => !['GIT_', 'LD_', 'NODE_TEST', 'BWRAP'].some((p) => name.startsWith(p)));
const VALID_CONFIG: fc.Arbitrary<ChecksConfig> = fc.record({
  image: fc.constant('node' as const),
  command: fc
    .tuple(fc.array(ARG, { maxLength: 4 }), fc.array(ARG, { maxLength: 4 }))
    .map(([before, after]) => ['node'].concat(before, ['--test'], after)),
  env: fc.dictionary(
    ENV_NAME,
    fc.string({ maxLength: 40 }).filter((v) => !v.includes('\0')),
    {
      maxKeys: 6,
    },
  ),
  timeout_seconds: fc.integer({ min: 1, max: 1800 }),
  protected_paths: fc.array(PATH, { maxLength: 6 }),
});

describe('properties', () => {
  it('reads back every valid config it is written as', () => {
    fc.assert(
      fc.property(VALID_CONFIG, (expected) => {
        expect(readChecksConfig(stringify(expected))).toEqual({ kind: 'valid', config: expected });
      }),
    );
  });

  it('never throws, and an invalid answer always says why', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.string({ unit: 'binary' })), (text) => {
        const resolution = readChecksConfig(text);
        if (resolution.kind === 'invalid') {
          expect(resolution.problems.length).toBeGreaterThan(0);
          for (const problem of resolution.problems) expect(problem.trim()).not.toBe('');
        } else {
          expect(resolution.kind).toBe('valid');
        }
      }),
    );
  });

  it('names any unknown key it refuses', () => {
    const unknown = fc
      .stringMatching(/^[a-z][a-z_]{2,14}$/)
      .filter(
        (key) =>
          !['image', 'command', 'timeout_seconds', 'protected_paths', 'env', 'check'].includes(key),
      );
    fc.assert(
      fc.property(VALID_CONFIG, unknown, (valid, key) => {
        const found = problems(stringify({ ...valid, [key]: 1 }));
        expect(found.join('\n')).toContain(`"${key}"`);
      }),
    );
  });

  it("refuses every one of the runner's own variables by name", () => {
    const owned = fc.oneof(
      fc.constantFrom('PATH', 'HOME', 'CI'),
      fc
        .tuple(
          fc.constantFrom('GIT_', 'LD_', 'NODE_TEST', 'BWRAP'),
          fc.stringMatching(/^[A-Z0-9_]{0,8}$/),
        )
        .map(([prefix, rest]) => `${prefix}${rest}`),
    );
    fc.assert(
      fc.property(VALID_CONFIG, owned, (valid, name) => {
        const found = problems(stringify({ ...valid, env: { ...valid.env, [name]: 'x' } }));
        expect(found).toContain(
          `env.${name}: is the runner's own (PATH, HOME, CI, GIT_*, LD_*, NODE_TEST*, BWRAP* are refused)`,
        );
      }),
    );
  });

  it('gives a suite the runner contract accepts for every valid config', () => {
    fc.assert(
      fc.property(VALID_CONFIG, (valid) => {
        const suite = suiteOf(valid);
        expect(RunSuite.safeParse(suite).success).toBe(true);
        expect(suite.files_argv.every((arg) => valid.command.includes(arg))).toBe(true);
      }),
    );
  });

  it('protects everything under a directory pattern and nothing beside it', () => {
    fc.assert(
      fc.property(SEGMENT, PATH, SEGMENT, (directory, inside, sibling) => {
        fc.pre(sibling !== directory);
        expect(matchesPattern(`${directory}/${inside}`, `${directory}/**`)).toBe(true);
        expect(matchesPattern(`${directory}/${inside}`, `${directory}/`)).toBe(true);
        expect(matchesPattern(`${sibling}/${inside}`, `${directory}/**`)).toBe(false);
      }),
    );
  });

  it('matches a path that is its own pattern, and * never crosses a /', () => {
    fc.assert(
      fc.property(PATH, (path) => {
        fc.pre(!/[*?]/.test(path));
        expect(matchesPattern(path, path)).toBe(true);
        expect(matchesPattern(path, '*')).toBe(!path.includes('/'));
      }),
    );
  });

  it('flags only changed files, and always the checks file', () => {
    fc.assert(
      fc.property(fc.array(PATH, { maxLength: 10 }), VALID_CONFIG, (files, valid) => {
        const patterns = protectedPatterns({ kind: 'valid', config: valid });
        const flagged = protectedChanges([...files, CHECKS_PATH], patterns);
        expect(flagged.every((file) => file === CHECKS_PATH || files.includes(file))).toBe(true);
        expect(flagged).toContain(CHECKS_PATH);
      }),
    );
  });
});
