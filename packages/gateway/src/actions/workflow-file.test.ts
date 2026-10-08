import { describe, expect, it } from 'vitest';

import { readWorkflowFile, secretNamesIn } from './workflow-file';

const LIMITS = { maxMatrixLegs: 16, maxTimeoutMinutes: 60 };

const DEPLOY = `name: Deploy
on:
  push:
    branches: [main]
    paths-ignore: ['docs/**']
  workflow_dispatch:
    inputs:
      level: { type: choice, options: [a, b], default: a }
  schedule: [{ cron: '0 3 * * *' }]
  pull_request:
concurrency: { group: deploy }
permissions: { contents: read }
jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 90
    outputs:
      v: \${{ steps.s.outputs.v }}
    steps:
      - uses: actions/checkout@v4
      - id: s
        run: echo "v=1" >> $GITHUB_OUTPUT
  deploy:
    needs: build
    if: \${{ needs.build.outputs.v == '1' }}
    runs-on: ubuntu-24.04
    permissions: { contents: write, id-token: write }
    steps:
      - run: npx wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.cloudflare_api_token }}
          T: \${{ secrets.GITHUB_TOKEN }}
`;

describe('reading a workflow file', () => {
  it('reads triggers, jobs, secrets and permissions with GitHub’s parser', async () => {
    const file = await readWorkflowFile('.github/workflows/deploy.yml', DEPLOY, LIMITS);
    expect(file.problems).toEqual([]);
    expect(file.name).toBe('Deploy');
    expect(file.triggers).toEqual([
      { kind: 'push', branches: ['main'], branchesIgnore: [], paths: [], pathsIgnore: ['docs/**'] },
      {
        kind: 'workflow_dispatch',
        inputs: [
          {
            name: 'level',
            description: null,
            type: 'choice',
            required: false,
            default: 'a',
            options: ['a', 'b'],
          },
        ],
      },
      { kind: 'schedule', crons: ['0 3 * * *'] },
    ]);
    expect(file.unsupportedEvents).toEqual(['pull_request']);
    const [build, deploy] = file.jobs;
    expect(build).toMatchObject({
      key: 'build',
      image: 'ubuntu-24.04',
      timeoutMinutes: 90,
      condition: 'success()',
      contentsWrite: false,
    });
    expect(build?.outputs).toEqual({ v: '${{ steps.s.outputs.v }}' });
    expect(build?.steps.map((step) => step.name)).toEqual([
      'Run actions/checkout@v4',
      'Run echo "v=1" >> $GITHUB_OUTPUT',
    ]);
    expect(deploy).toMatchObject({
      needs: ['build'],
      contentsWrite: true,
      idTokenWrite: true,
      secretNames: ['CLOUDFLARE_API_TOKEN'],
    });
    expect(deploy?.condition).toContain("needs.build.outputs.v == '1'");
  });

  it('writes the compatibility report', async () => {
    const file = await readWorkflowFile('.github/workflows/deploy.yml', DEPLOY, LIMITS);
    const verdicts = Object.fromEntries(
      file.compatibility.map((note) => [note.feature, note.verdict]),
    );
    expect(verdicts).toMatchObject({
      'on: pull_request': 'after-mvp',
      concurrency: 'runs-differently',
      'jobs.build.timeout-minutes': 'runs-differently',
      'jobs.deploy.permissions.id-token': 'never-runs',
    });
  });

  it('reports a schema error with its line and column', async () => {
    const file = await readWorkflowFile(
      '.github/workflows/bad.yml',
      'on: push\njobs:\n  a:\n    runs-on: x\n    stepz: []\n',
      LIMITS,
    );
    expect(file.problems[0]).toMatchObject({ line: 5, column: 5 });
    expect(file.problems[0]?.message).toContain('stepz');
    expect(file.jobs).toEqual([]);
  });

  it('marks Docker needs for Docker mode and unknown runners as never running', async () => {
    const file = await readWorkflowFile(
      '.github/workflows/x.yml',
      `on: push
jobs:
  a:
    runs-on: macos-latest
    steps: [{ run: 'true' }]
  b:
    runs-on: ubuntu-latest
    services: { redis: { image: redis } }
    steps: [{ uses: 'docker://alpine:3' }]
`,
      LIMITS,
    );
    const verdicts = Object.fromEntries(
      file.compatibility.map((note) => [note.feature, note.verdict]),
    );
    expect(verdicts['jobs.a.runs-on']).toBe('never-runs');
    expect(verdicts['jobs.b.services']).toBe('runs-differently');
    expect(verdicts['jobs.b.steps[1]']).toBe('runs-differently');
    expect(file.jobs[0]?.image).toBeNull();
  });

  it('expands a matrix with include and exclude, and refuses one too wide', async () => {
    const file = await readWorkflowFile(
      '.github/workflows/m.yml',
      `on: push
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [20, 22]
        os: [linux]
        exclude: [{ node: 20 }]
        include: [{ node: 22, extra: yes }, { node: 24 }]
    steps: [{ run: 'true' }]
  wide:
    runs-on: ubuntu-latest
    strategy: { matrix: { a: [1, 2, 3, 4, 5], b: [1, 2, 3, 4] } }
    steps: [{ run: 'true' }]
`,
      LIMITS,
    );
    expect(file.jobs[0]?.matrix).toEqual({
      kind: 'legs',
      legs: [{ node: 22, os: 'linux', extra: 'yes' }, { node: 24 }],
    });
    expect(file.jobs[1]?.matrix).toMatchObject({ kind: 'invalid' });
    expect(file.problems.map((problem) => problem.message)).toEqual([
      'job wide: the matrix has 20 legs; at most 16 run',
    ]);
  });

  it('treats a tags-only push as not run yet', async () => {
    const file = await readWorkflowFile(
      '.github/workflows/t.yml',
      'on:\n  push:\n    tags: [v*]\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps: [{ run: "true" }]\n',
      LIMITS,
    );
    expect(file.triggers).toEqual([]);
    expect(file.unsupportedEvents).toContain('push (tags)');
  });

  it('finds secret names in both expression forms, without GITHUB_TOKEN', () => {
    expect(
      secretNamesIn("${{ secrets.a_b }} ${{ secrets['C'] }} ${{ secrets.GITHUB_TOKEN }}"),
    ).toEqual(['A_B', 'C']);
  });
});
