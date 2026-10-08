import { describe, expect, it } from 'vitest';

import type {
  ActionsRpc,
  JobView,
  LogChunkPage,
  RunDetail,
  RunSummary,
  WorkflowSummary,
} from '@beanstalk/shared-race/actions';
import type { RpcResult } from '@beanstalk/shared-race/rpc';

import { gatewayActionsClient } from './gateway-actions';
import { groupByStep } from './log-view';

const REPO = 'repo-1';
const RUN = '0b6c1a50-8d2f-4a8e-9b1e-1f2a3b4c5d6e';
const MONTH = new Date().toISOString().slice(0, 7);

function ok<T>(value: T): Promise<RpcResult<T>> {
  return Promise.resolve({ ok: true, value });
}

const WORKFLOW = {
  path: '.github/workflows/ci.yml',
  name: 'CI',
  state: 'active',
  triggers: [
    { kind: 'push', branches: ['main'], branchesIgnore: [], paths: [], pathsIgnore: [] },
    { kind: 'workflow_dispatch', inputs: [] },
  ],
  unsupportedEvents: ['pull_request'],
  jobs: [],
  problems: [],
  compatibility: [
    { feature: 'concurrency', verdict: 'runs-differently', detail: 'enforced outside act' },
    { feature: 'run steps', verdict: 'runs', detail: '' },
  ],
  sha: 'a'.repeat(40),
  indexedAt: `${MONTH}-02T00:00:00.000Z`,
} as unknown as WorkflowSummary;

function summary(overrides: Readonly<Record<string, unknown>> = {}): RunSummary {
  return {
    id: RUN,
    repoId: REPO,
    number: 7,
    workflowPath: '.github/workflows/ci.yml',
    workflowName: 'CI',
    event: 'push',
    ref: 'refs/heads/main',
    sha: 'b'.repeat(40),
    status: 'completed',
    conclusion: 'infrastructure_failure',
    reason: 'the container stopped',
    actor: 'coop',
    createdAt: `${MONTH}-03T10:00:00.000Z`,
    startedAt: `${MONTH}-03T10:00:03.000Z`,
    completedAt: `${MONTH}-03T10:02:00.000Z`,
    minutesBilled: 3,
    ...overrides,
  } as RunSummary;
}

function job(id: string, key: string, needs: readonly string[]): JobView {
  return {
    id,
    key,
    name: key,
    matrix: null,
    needs,
    status: 'waiting',
    conclusion: null,
    reason: null,
    steps: [],
    outputs: {},
    startedAt: null,
    completedAt: null,
    minutesBilled: 0,
  } as unknown as JobView;
}

function gateway(overrides: Partial<ActionsRpc> = {}): ActionsRpc {
  const detail = {
    ...summary(),
    jobs: [job('j1', 'test', []), job('j2', 'test', []), job('j3', 'deploy', ['test'])],
    inputs: {},
  } as unknown as RunDetail;
  const pages: Record<number, LogChunkPage> = {
    0: {
      chunks: [
        {
          seq: 1,
          lines: [
            { step: null, at: 'x', text: 'Set up' },
            { step: 1, at: 'x', text: 'one' },
          ],
        },
      ],
      next: 1,
      complete: true,
    },
    1: {
      chunks: [{ seq: 2, lines: [{ step: 1, at: 'x', text: 'two' }] }],
      next: null,
      complete: true,
    },
  };
  return {
    listWorkflows: () => ok([WORKFLOW]),
    dispatchWorkflow: () => ok(summary({ conclusion: null, status: 'queued' })),
    listRuns: () => ok({ runs: [summary(), summary({ minutesBilled: 4 })], next: null }),
    getRun: () => ok(detail),
    cancelRun: () => ok(summary()),
    logStream: () => ok({ url: 'wss://x', token: 't', expiresAt: 'x' }),
    logChunks: (_viewer, _run, _job, after) => ok(pages[after ?? 0] ?? pages[0]),
    listSecrets: () => ok([]),
    putSecret: () =>
      ok({ name: 'A', prelandAllowed: true, updatedAt: 'x', updatedBy: 'coop' } as never),
    deleteSecret: () => ok({ deleted: true }),
    ...overrides,
  } as ActionsRpc;
}

const scope = { actor: { id: 'u1', handle: 'coop' }, repoId: REPO };

describe('the gateway adapter', () => {
  it('reads workflows with their unsupported events, notes that matter and last run', async () => {
    const result = await gatewayActionsClient(gateway(), scope).workflows();
    expect(result.ok).toBe(true);
    const [workflow] = result.ok ? result.value : [];
    expect(workflow?.triggers.map((trigger) => trigger.event)).toEqual([
      'push',
      'workflow_dispatch',
      'other',
    ]);
    expect(workflow?.notes).toEqual([
      { level: 'differs', text: 'concurrency: enforced outside act' },
    ]);
    expect(workflow?.lastRun?.conclusion).toBe('infra_lost');
  });

  it('turns job keys in needs into job ids, every matrix leg included', async () => {
    const result = await gatewayActionsClient(gateway(), scope).run(RUN);
    expect(result.ok && result.value.jobs.find((item) => item.id === 'j3')?.needs).toEqual([
      'j1',
      'j2',
    ]);
    expect(result.ok && result.value.jobs[0]?.status).toBe('queued');
    expect(result.ok && result.value.canRerun).toBe(true);
    expect(result.ok && result.value.reason).toBe('the container stopped');
  });

  it('hides a run of another repository', async () => {
    const other = gateway({
      getRun: () =>
        ok({ ...summary({ repoId: 'other' }), jobs: [], inputs: {} }),
    });
    const result = await gatewayActionsClient(other, scope).run(RUN);
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('numbers log lines across stored chunks and keeps the job lines apart', async () => {
    const result = await gatewayActionsClient(gateway(), scope).log(RUN, 'j1', 1);
    expect(result.ok && result.value.lines.map((line) => [line.n, line.step, line.text])).toEqual([
      [2, 1, 'one'],
      [3, 1, 'two'],
    ]);
    const all = await gatewayActionsClient(gateway(), scope).log(RUN, 'j1', 0);
    const step = {
      number: 1,
      name: 'test',
      status: 'completed',
      conclusion: 'success',
      startedAt: null,
      completedAt: null,
    } as const;
    const groups = groupByStep([step], all.ok ? all.value.lines : []);
    expect(groups.map((group) => group.step.name)).toEqual(['Job', 'test']);
  });

  it('adds up this month’s minutes for the meter', async () => {
    const result = await gatewayActionsClient(gateway(), scope).secrets();
    expect(result.ok && result.value.usage).toMatchObject({
      minutesUsed: 7,
      minutesIncluded: 100,
      jobTimeoutMinutes: 60,
    });
  });

  it('asks for the value again to change pre-land access', async () => {
    const client = gatewayActionsClient(gateway(), scope);
    expect(client.canToggleSecretWithoutValue).toBe(false);
    const result = await client.putSecret({ name: 'A', value: null, availableToPreland: true });
    expect(result.ok).toBe(false);
  });

  it('reads a binding that throws as unavailable', async () => {
    const broken = gateway({
      listWorkflows: () => Promise.reject(new Error('no such entrypoint')),
    });
    const result = await gatewayActionsClient(broken, scope).workflows();
    expect(result).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  });
});
