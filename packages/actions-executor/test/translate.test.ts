import { describe, expect, it } from 'vitest';

import type { RunnerLine, RunnerResult } from '../src/job/runner-wire';
import { jobRequestOf } from '../src/job/runner-wire';
import { StepTracker, jobConclusion, minutesBilled } from '../src/job/translate';
import { spec } from './fake-ports';

function runnerLine(fields: Partial<RunnerLine>): RunnerLine {
  return { seq: 0, at: 1_700_000_000_000, kind: 'output', level: 'info', text: '', ...fields };
}

function result(fields: Partial<RunnerResult>): RunnerResult {
  return {
    jobId: 'j',
    conclusion: 'success',
    outputs: {},
    unresolvedOutputs: [],
    startedAt: 0,
    finishedAt: 0,
    lines: 0,
    batches: 0,
    actVersion: '',
    imageVersion: '',
    ...fields,
  };
}

describe('step numbers', () => {
  const tracker = new StepTracker(spec().steps);

  it('maps act’s index (from 0) and a step’s id to the workflow’s number (from 1)', () => {
    expect(tracker.stepNumber('0')).toBe(1);
    expect(tracker.stepNumber('1')).toBe(2);
    expect(tracker.stepNumber('v')).toBe(3);
    expect(tracker.stepNumber('1/0')).toBe(2);
  });

  it('gives the job’s own lines no step', () => {
    expect(tracker.stepNumber('--setup-job')).toBeNull();
    expect(tracker.stepNumber(undefined)).toBeNull();
  });
});

describe('log text', () => {
  it('writes groups and annotations as GitHub’s log markers', () => {
    const tracker = new StepTracker(spec().steps);
    const { lines } = tracker.translate([
      runnerLine({ kind: 'group-start', stepId: '0', text: 'Fetching' }),
      runnerLine({ kind: 'group-end', stepId: '0' }),
      runnerLine({
        kind: 'annotation',
        stepId: '1',
        level: 'error',
        text: 'bad',
        annotation: { level: 'error', message: 'bad', file: 'a.ts', line: 3, title: 'Lint' },
      }),
      runnerLine({ kind: 'debug', text: 'hidden' }),
    ]);
    expect(lines.map((l) => l.text)).toEqual([
      '##[group]Fetching',
      '##[endgroup]',
      '##[error]a.ts:3: Lint: bad',
    ]);
  });

  it('closes steps still running when the job ends', () => {
    const tracker = new StepTracker(spec().steps);
    tracker.translate([
      runnerLine({ kind: 'step-start', stage: 'Main', stepId: '1', text: 'Run Main npm ci' }),
    ]);
    const closed = tracker.closeOpenSteps('timed_out', 1_700_000_100_000);
    expect(closed).toEqual([
      expect.objectContaining({ number: 2, status: 'completed', conclusion: 'timed_out' }),
    ]);
  });
});

describe('conclusions and billing', () => {
  it('maps the runner’s reasons to GitHub’s conclusions', () => {
    expect(jobConclusion(result({ conclusion: 'success' }))).toBe('success');
    expect(jobConclusion(result({ conclusion: 'failure', reason: 'steps' }))).toBe('failure');
    expect(jobConclusion(result({ conclusion: 'failure', reason: 'workflow' }))).toBe('failure');
    expect(jobConclusion(result({ conclusion: 'failure', reason: 'unsupported' }))).toBe('failure');
    expect(jobConclusion(result({ conclusion: 'failure', reason: 'timeout' }))).toBe('timed_out');
    expect(jobConclusion(result({ conclusion: 'cancelled', reason: 'cancelled' }))).toBe(
      'cancelled',
    );
    expect(jobConclusion(result({ conclusion: 'failure', reason: 'runner' }))).toBe(
      'infrastructure_failure',
    );
  });

  it('bills whole minutes, rounded up, at least one', () => {
    expect(minutesBilled(1)).toBe(1);
    expect(minutesBilled(60_000)).toBe(1);
    expect(minutesBilled(60_001)).toBe(2);
  });
});

describe('the job request', () => {
  it('points the job at the forge and passes the finished jobs it needs', () => {
    const request = jobRequestOf(
      spec({
        needs: { build: { result: 'timed_out', outputs: { v: '1' } } },
        matrix: { node: 20 },
      }),
      {},
    );
    expect(request).toMatchObject({
      github: {
        serverUrl: 'https://gateway.example',
        apiUrl: 'https://gateway.example/api/v3',
        runNumber: '3',
      },
      token: 'bsj_job_token',
      needs: { build: { result: 'failure', outputs: { v: '1' } } },
      matrix: { node: 20 },
    });
  });
});
