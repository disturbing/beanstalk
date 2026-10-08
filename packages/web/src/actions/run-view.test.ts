import { describe, expect, it } from 'vitest';

import type { DispatchInput, Job } from './actions-contract';
import { dispatchInputsOf, filterHref, runFilterOf } from './run-filters';
import { cronWords, focusJob, formatDuration, jobColumns, stateOf } from './run-view';

function job(id: string, needs: readonly string[], conclusion: Job['conclusion'] = 'success'): Job {
  return {
    id,
    name: id,
    needs: [...needs],
    runsOn: 'ubuntu-latest',
    status: conclusion === null ? 'in_progress' : 'completed',
    conclusion,
    startedAt: null,
    completedAt: null,
    steps: [],
  };
}

describe('run states and words', () => {
  it('folds status and conclusion into one state', () => {
    expect(stateOf({ status: 'queued', conclusion: null })).toBe('queued');
    expect(stateOf({ status: 'in_progress', conclusion: null })).toBe('running');
    expect(stateOf({ status: 'completed', conclusion: 'timed_out' })).toBe('timed_out');
  });

  it('formats durations the way a run list reads them', () => {
    expect(formatDuration(41_200)).toBe('41s');
    expect(formatDuration(112_000)).toBe('1m 52s');
    expect(formatDuration(3_780_000)).toBe('1h 3m');
    expect(formatDuration(null)).toBe('');
  });

  it('says common crons in words and leaves the rest as cron', () => {
    expect(cronWords('0 3 * * *')).toBe('daily at 03:00 UTC');
    expect(cronWords('15 * * * *')).toBe('hourly at :15');
    expect(cronWords('*/5 * * * 1')).toBe('cron */5 * * * 1');
  });
});

describe('the job graph', () => {
  it('puts each job one column after the deepest job it needs', () => {
    const jobs = [job('lint', []), job('build', []), job('test', ['lint', 'build']), job('deploy', ['test'])];
    expect(jobColumns(jobs).map((column) => column.map((item) => item.id))).toEqual([
      ['lint', 'build'],
      ['test'],
      ['deploy'],
    ]);
  });

  it('survives a cycle and a need on a missing job', () => {
    const jobs = [job('a', ['b']), job('b', ['a']), job('c', ['ghost'])];
    expect(jobColumns(jobs).flat()).toHaveLength(3);
  });

  it('opens on the failed job, else the running one', () => {
    expect(focusJob([job('a', []), job('b', [], 'failure'), job('c', [], null)])?.id).toBe('b');
    expect(focusJob([job('a', []), job('c', [], null)])?.id).toBe('c');
    expect(focusJob([])).toBeNull();
  });
});

describe('the runs list URL', () => {
  it('reads filters from the query and ignores unknown statuses', () => {
    expect(runFilterOf({ workflow: '.github/workflows/ci.yml', status: 'nope', before: '12' })).toEqual({
      limit: 25,
      workflow: '.github/workflows/ci.yml',
      before: '12',
    });
  });

  it('resets paging when a filter changes', () => {
    const filter = runFilterOf({ status: 'failure', before: '99' });
    expect(filterHref('/a/b/actions', filter, { workflow: 'ci.yml' })).toBe(
      '/a/b/actions?status=failure&workflow=ci.yml',
    );
    expect(filterHref('/a/b/actions', filter, { status: null })).toBe('/a/b/actions');
    expect(filterHref('/a/b/actions', filter, { before: '42' })).toBe('/a/b/actions?status=failure&before=42');
  });
});

describe('dispatch inputs', () => {
  const declared: readonly DispatchInput[] = [
    { name: 'environment', description: null, type: 'choice', required: true, default: 'staging', options: ['staging', 'production'] },
    { name: 'dry-run', description: null, type: 'boolean', required: false, default: 'false', options: [] },
    { name: 'count', description: null, type: 'number', required: false, default: null, options: [] },
  ];

  function form(entries: Readonly<Record<string, string>>): FormData {
    const data = new FormData();
    for (const [key, entry] of Object.entries(entries)) data.set(key, entry);
    return data;
  }

  it('accepts declared values and reads an unticked box as false', () => {
    expect(dispatchInputsOf(declared, form({ 'input:environment': 'production' }))).toEqual({
      ok: true,
      inputs: { environment: 'production', 'dry-run': 'false' },
    });
  });

  it('refuses a missing required input, an undeclared choice and a non-number', () => {
    expect(dispatchInputsOf(declared, form({})).ok).toBe(false);
    expect(dispatchInputsOf(declared, form({ 'input:environment': 'moon' })).ok).toBe(false);
    expect(dispatchInputsOf(declared, form({ 'input:environment': 'staging', 'input:count': 'ten' })).ok).toBe(false);
  });
});
