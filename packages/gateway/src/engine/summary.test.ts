import { describe, expect, it } from 'vitest';

import { buildSummary } from './summary';
import { runRace, soloTask } from './testing/scenario';

// Key order of research/race/runs/main-q-haiku-40/summary.json (a local queue run).
const SUMMARY_KEYS = [
  'label',
  'policy',
  'agent',
  'model',
  'arena_base',
  'arena_digest',
  'config',
  'aborted',
  'wall_seconds',
  'tasks',
  'tasks_green',
  'tasks_landed',
  'tasks_dropped',
  'acceptance_restored',
  'drops_by_reason',
  'changes_green_per_hour',
  'wall_to_all_green_seconds',
  'task_start_to_green_seconds',
  'agent_minutes',
  'agent_minutes_per_agent',
  'invocations',
  'invocation_stats',
  'cost_usd',
  'cost_by_kind',
  'tokens_by_kind',
  'invocation_overhead',
  'subscription',
  'ci_runs',
  'ci_runs_total',
  'ci_minutes',
  'ci_minutes_total',
  'textual_conflicts',
  'red_validations',
  'final',
  'footprint_quality',
  'per_task',
  'queue',
  'policy_rows',
];

describe('buildSummary', () => {
  const race = runRace({
    tasks: [
      soloTask('t001'),
      {
        id: 't002',
        writes: { 'src/t002/index.ts': "export const t002 = 'BUG:t002'; // impl:t002\n" },
      },
    ],
    rules: [{ markers: ['BUG:t002'], file: 'tests/t002.test.ts', name: 't002 works' }],
    config: { agents: 2, batch: 1, arena: '/x/research/arena', arena_digest: '8c321b3577cd83fd' },
  });
  const summary = buildSummary(race.state, race.env, race.state.clock);

  it('has the keys of a local summary.json, in order', () => {
    expect(Object.keys(summary)).toEqual(SUMMARY_KEYS);
  });

  it('reports the metrics report.py compares', () => {
    expect(summary).toMatchObject({
      policy: 'queue',
      agent: 'replay',
      model: 'replay',
      tasks: 2,
      tasks_green: 2,
      tasks_dropped: 0,
      cost_usd: 0.03,
      invocations: { initial: 2, rework: 1 },
      textual_conflicts: 0,
      red_validations: 1,
      final: { correct: true, all_tasks_accepted: true },
      config: {
        agents: 2,
        ci_seconds: 60,
        ci_slots: 2,
        batch: 1,
        union_merge: false,
        queue_hold: true,
      },
      queue: {
        batches: 4,
        batches_green: 2,
        batches_red: 1,
        batches_cancelled: 1,
        ejections_red: 1,
      },
    });
    expect(summary['label']).toBe(
      `measured: arena=arena@${race.world.baseSha.slice(0, 8)}/8c321b35, 2 tasks, policy=queue, ` +
        'agent=replay (replay control: reference patches, synthetic timings)',
    );
    expect(summary['ci_runs']).toEqual({ batch: 3, 'batch-cancelled': 1 });
    expect(summary['ci_runs_total']).toBe(4);
    expect(summary['changes_green_per_hour']).toBeGreaterThan(0);
    expect(summary['policy_rows']).toEqual([
      ['Batches (green / red / cancelled)', '2 / 1 / 1'],
      ['Bisections / bisect CI runs', '0 / 0'],
      ['Ejections (conflict / red)', '0 / 1'],
      ['PRs held behind in-flight conflicts', 0],
      ['Mean batch size', 1],
    ]);
  });

  it('describes every task with its timings relative to race.start', () => {
    const perTask = summary['per_task'];

    expect(perTask).toMatchObject({
      t001: { status: 'green', reworks: 0, reds: 0, invocations: 1, final_acceptance: true },
      t002: { status: 'green', reworks: 1, reds: 1, invocations: 2, final_acceptance: true },
    });
  });
});
