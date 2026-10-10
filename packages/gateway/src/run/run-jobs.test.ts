import { describe, expect, it } from 'vitest';

import { RunId, Sha } from '@gitstalk/shared-race/ids';
import { DEFAULT_SUITE } from '@gitstalk/shared-race/suite';

import type { ArtifactsPort } from '../adapters/artifacts';
import type { JobSpec } from '../engine/model';
import { createLogger } from '../log';
import type { RunnerCheck, RunnerPort } from '../runner/runner-client';
import type { JobContext } from './run-jobs';
import { SUITE_TIMEOUT_ATTEMPTS, executeJob, readMapOptions } from './run-jobs';

type CheckSpec = Extract<JobSpec, { kind: 'check' }>;

const PRELAND: CheckSpec = {
  kind: 'check',
  sha: Sha.parse('a'.repeat(40)),
  extraFiles: null,
  instance: { kind: 'sandbox', slot: 'a0' },
};
const VALIDATION: CheckSpec = { ...PRELAND, instance: { kind: 'ci', slot: 0 } };

describe('readMapOptions', () => {
  it('traces pre-land checks only, and asks validations for their manifest, under preland', () => {
    expect(readMapOptions(PRELAND, 'preland')).toEqual({ trace: true, treeManifest: true });
    expect(readMapOptions(VALIDATION, 'preland')).toEqual({ trace: false, treeManifest: true });
  });

  it('traces a validation that asks for every read set (evidence), unless off', () => {
    expect(readMapOptions({ ...VALIDATION, allReadSets: true }, 'preland').trace).toBe(true);
    expect(readMapOptions({ ...VALIDATION, allReadSets: true }, 'off').trace).toBe(false);
  });

  it('traces every check under all and none under off', () => {
    expect(readMapOptions(VALIDATION, 'all')).toEqual({ trace: true, treeManifest: true });
    expect(readMapOptions(PRELAND, 'off')).toEqual({ trace: false, treeManifest: false });
  });

  it("lets a job's own choice win", () => {
    expect(readMapOptions({ ...VALIDATION, trace: true }, 'off').trace).toBe(true);
    expect(readMapOptions({ ...PRELAND, trace: false }, 'all').trace).toBe(false);
  });
});

const RUN = RunId.parse('r0123456789abcdef012');

function suiteRun(outcome: 'green' | 'timed-out'): RunnerCheck {
  const isGreen = outcome === 'green';
  return {
    green: isGreen,
    tests: isGreen ? 12 : 0,
    failures: 0,
    failingTests: [],
    failingFiles: isGreen ? [] : null,
    passingFiles: null,
    readSet: [],
    readSets: {},
    readDepths: {},
    stackFiles: [],
    output: '',
    suiteSeconds: isGreen ? 34 : 300,
    timedOut: !isGreen,
    network: null,
    ciSeconds: null,
  };
}

/** A port call no check makes. */
async function unused(): Promise<never> {
  throw new Error('a check makes no such call');
}

/** A runner whose suites play `script` in order (then stay green); it keeps the instances asked. */
function scriptedRunner(script: readonly ('green' | 'timed-out')[]): RunnerPort & {
  instances: string[];
} {
  const instances: string[] = [];
  return {
    instances,
    squash: unused,
    revert: unused,
    updateRef: unused,
    async check(instance) {
      instances.push(instance);
      return suiteRun(script[instances.length - 1] ?? 'green');
    },
  };
}

function unusedArtifacts(): ArtifactsPort {
  return {
    createRepo: unused,
    mintToken: unused,
    branchHead: unused,
    readFile: unused,
    changedFiles: unused,
    changedPaths: unused,
    listRepos: unused,
    deleteRepo: unused,
    describeRepo: unused,
    commitMessage: unused,
    history: unused,
  };
}

function jobContext(runner: RunnerPort, extra: Partial<JobContext> = {}): JobContext {
  return {
    run: RUN,
    artifacts: unusedArtifacts(),
    runner,
    tokens: { token: async () => 'read-token' },
    log: createLogger('error'),
    repos: () => ({ repo: { name: 'repo-x', remote: 'https://artifacts.test/repo-x.git' } }),
    suite: DEFAULT_SUITE,
    engine: 'race',
    ...extra,
  };
}

describe('a check whose suite times out', () => {
  it('runs again on the same sandbox, and the engine only sees the run that finished', async () => {
    const runner = scriptedRunner(['timed-out', 'green']);
    let timeouts = 0;

    const outcome = await executeJob(
      PRELAND,
      jobContext(runner, {
        onSuiteTimeout: () => {
          timeouts += 1;
        },
      }),
    );

    expect(outcome).toMatchObject({ ok: true, result: { kind: 'check', check: { green: true } } });
    expect(runner.instances).toEqual([`run-${RUN}-sandbox-a0`, `run-${RUN}-sandbox-a0`]);
    expect(timeouts).toBe(1);
  });

  it("is never a bean's red: one that times out every time fails the job as infrastructure", async () => {
    const runner = scriptedRunner(
      Array.from({ length: SUITE_TIMEOUT_ATTEMPTS }, () => 'timed-out' as const),
    );

    const outcome = await executeJob(PRELAND, jobContext(runner));

    expect(runner.instances).toHaveLength(SUITE_TIMEOUT_ATTEMPTS);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.retryable).toBe(false);
    expect(outcome.error).toMatch(/^suite_timeout: the suite ran past its 300 s limit 3 times/);
    expect(outcome.error).toContain('not a test failure');
  });

  it("leaves a validation that times out every time to the engine, as the line's result", async () => {
    const runner = scriptedRunner(
      Array.from({ length: SUITE_TIMEOUT_ATTEMPTS }, () => 'timed-out' as const),
    );

    const outcome = await executeJob(VALIDATION, jobContext(runner));

    expect(runner.instances).toEqual(
      Array.from({ length: SUITE_TIMEOUT_ATTEMPTS }, () => `run-${RUN}-ci-0`),
    );
    expect(outcome).toMatchObject({ ok: true, result: { check: { timedOut: true } } });
  });
});

describe("a repository engine's check", () => {
  it('runs in the sandbox leased for it', async () => {
    const runner = scriptedRunner(['green']);

    await executeJob(PRELAND, jobContext(runner, { engine: 'continuous', sandboxIndex: 7 }));

    expect(runner.instances).toEqual([`run-${RUN}-sandbox-7`]);
  });
});
