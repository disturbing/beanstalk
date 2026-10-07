import { describe, expect, it } from 'vitest';

import { readChecksConfig } from '@beanstalk/shared-race/checks-config';
import type { SessionVia } from '@beanstalk/shared-race/collaborators';
import { RunId, Sha } from '@beanstalk/shared-race/ids';

import type { GitCredential } from '../auth/git-credential';
import { templateFiles } from '../repos/templates';
import type { LandingTree } from './check-store';
import { protectedAccessOf } from './protected-access';
import type { RepositoryChecksHost } from './repository-checks';
import { decide, planCheck, protectedGuard } from './repository-checks';

const SPROUT = Sha.parse('a'.repeat(40));
const MERGED = Sha.parse('b'.repeat(40));
const AGENT = { allowed: false, who: '@agent (write, with an agent session token)' };
const OWNER = { allowed: true, who: '@coop (owner, with a personal token)' };

function landing(files: readonly string[]): LandingTree {
  return { sha: MERGED, task: 'bean-1', onto: SPROUT, files };
}

function host(input: {
  files: Readonly<Record<string, string | null>>;
  landing?: LandingTree;
  access?: typeof AGENT;
}): RepositoryChecksHost & { recorded: Map<string, readonly string[]> } {
  const recorded = new Map<string, readonly string[]>();
  return {
    recorded,
    readChecks: async (sha) => input.files[sha] ?? null,
    saveLandingTree: () => undefined,
    landingTree: (sha) => (input.landing?.sha === sha ? input.landing : null),
    protectedAccess: () => input.access ?? AGENT,
    record: (sha, lines) => recorded.set(sha, lines),
  };
}

describe('deciding a check from the tree', () => {
  it('answers green with no tests when the tree has no checks file', () => {
    const { plan, lines } = decide(readChecksConfig(null), null);
    expect(plan).toMatchObject({ kind: 'answer', result: { green: true, tests: 0 } });
    expect(lines).toEqual([
      'beanstalk: no .beanstalk/checks.toml on this tree: no checks run, and a bean lands when it merges cleanly',
    ]);
  });

  it('answers red with every problem when the file is invalid, and runs nothing', () => {
    const { plan, lines } = decide(readChecksConfig('image = "rust"\ncomand = []\n'), null);
    if (plan.kind !== 'answer') throw new Error('expected an answer');
    expect(plan.result).toMatchObject({
      green: false,
      failingFiles: ['.beanstalk/checks.toml'],
      failingTests: [{ file: '.beanstalk/checks.toml', name: 'the checks config is valid' }],
    });
    expect(plan.result.output).toContain('unknown key "comand" (did you mean "command"?)');
    expect(lines[0]).toBe('beanstalk: .beanstalk/checks.toml is invalid:');
  });

  it('runs the suite a valid file declares', () => {
    const { plan } = decide(readChecksConfig('command = ["node", "--test", "spec/"]'), null);
    expect(plan).toMatchObject({ kind: 'run', suite: { argv: ['node', '--test', 'spec/'] } });
  });

  it('refuses a protected change before reading anything else, naming the paths and the pusher', () => {
    const sprout = readChecksConfig('protected_paths = ["migrations/**"]');
    const guard = protectedGuard(landing(['migrations/1.sql', 'src/a.ts']), sprout, AGENT);
    const { plan, lines } = decide(readChecksConfig('command = ["node", "--test"]'), guard);
    if (plan.kind !== 'answer') throw new Error('expected an answer');
    expect(plan.result.failingTests).toEqual([
      { file: 'migrations/1.sql', name: 'changes a protected path', message: 'migrations/1.sql' },
    ]);
    expect(plan.result.output).toContain('this push was by @agent');
    expect(lines).toEqual([
      'beanstalk: changes protected paths (migrations/1.sql): refused for @agent (write, with an agent session token)',
    ]);
  });

  it("lets the owner change protected paths and then checks the owner's new config", () => {
    const guard = protectedGuard(
      landing(['.beanstalk/checks.toml']),
      readChecksConfig(null),
      OWNER,
    );
    const { plan, lines } = decide(readChecksConfig('timeout_seconds = 30'), guard);
    expect(plan).toMatchObject({ kind: 'run', suite: { timeout_seconds: 30 } });
    expect(lines[0]).toBe(
      'beanstalk: changes protected paths (.beanstalk/checks.toml): allowed for @coop (owner, with a personal token)',
    );
  });

  it('takes protected paths from the sprout, so a bean cannot unprotect its own change', async () => {
    const checks = host({
      files: {
        [SPROUT]: 'protected_paths = ["LICENSE"]',
        [MERGED]: 'protected_paths = []',
      },
      landing: landing(['LICENSE', '.beanstalk/checks.toml']),
    });
    const plan = await planCheck(checks, {
      sha: MERGED,
      instance: { kind: 'sandbox', slot: 'a0' },
    });
    expect(plan).toMatchObject({ kind: 'answer', result: { green: false } });
    expect(checks.recorded.get(MERGED)?.[0]).toContain(
      '(LICENSE, .beanstalk/checks.toml): refused',
    );
  });

  it('applies no protected paths to a validation of the sprout', async () => {
    const checks = host({
      files: { [MERGED]: 'command = ["node", "--test"]' },
      landing: landing(['.beanstalk/checks.toml']),
    });
    const plan = await planCheck(checks, { sha: MERGED, instance: { kind: 'ci', slot: 0 } });
    expect(plan.kind).toBe('run');
  });
});

describe('the TypeScript starter', () => {
  it('declares checks that read as valid: node --test, two minutes', () => {
    const file = templateFiles('typescript-starter', 'greeter', '').find(
      (seed) => seed.path === '.beanstalk/checks.toml',
    );
    expect(readChecksConfig(file?.content ?? null)).toMatchObject({
      kind: 'valid',
      config: { command: ['node', '--test'], timeout_seconds: 120, protected_paths: [] },
    });
  });
});

function credential(via: SessionVia | null): GitCredential {
  return {
    user: { id: 'u1', handle: 'coop' },
    scopes: ['repo:read', 'bean:write'],
    engine: null,
    runPrincipal: null,
    session: via === null ? null : { via, id: 'c1' },
  };
}

describe('who may change protected paths', () => {
  it.each([
    ['personal-token', 'owner', true],
    ['ssh-key', 'maintain', true],
    ['personal-token', 'write', false],
    ['agent-session', 'owner', false],
    ['mcp', 'owner', false],
    ['deploy-token', null, false],
  ] as const)('%s with role %s: %s', (via, role, allowed) => {
    expect(protectedAccessOf(credential(via), role).allowed).toBe(allowed);
  });

  it('never lets an engine token change them', () => {
    expect(protectedAccessOf(credential(null), 'owner')).toEqual({
      allowed: false,
      who: '@coop (owner, with an engine token)',
    });
  });

  it('names a deploy token as acting for the person who made it', () => {
    const deploy = { ...credential('deploy-token'), engine: RunId.parse('r0123456789abcdef012') };
    expect(protectedAccessOf(deploy, null)).toEqual({
      allowed: false,
      who: 'a deploy token acting for @coop',
    });
  });
});
