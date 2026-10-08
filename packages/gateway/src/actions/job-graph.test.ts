import { describe, expect, it } from 'vitest';

import type { JobState } from './job-graph';
import { needResult, planJobs, readiness, runConclusion } from './job-graph';
import { readWorkflowFile } from './workflow-file';

const RUN = {
  contexts: { github: { event_name: 'push' }, inputs: {}, vars: {} },
  cancelled: false,
};

function state(
  key: string,
  conclusion: JobState['conclusion'],
  outputs: Record<string, string> = {},
): JobState {
  return { key, status: conclusion === null ? 'in_progress' : 'completed', conclusion, outputs };
}

describe('the job DAG', () => {
  it('waits for needs, then starts on success and skips after a failure', () => {
    const job = { needs: ['build'], condition: 'success()' };
    expect(readiness(job, [state('build', null)], RUN)).toEqual({ kind: 'blocked' });
    expect(readiness(job, [state('build', 'success')], RUN)).toEqual({ kind: 'start' });
    expect(readiness(job, [state('build', 'failure')], RUN)).toEqual({ kind: 'skip' });
    expect(readiness(job, [state('build', 'skipped')], RUN)).toEqual({ kind: 'skip' });
  });

  it('runs always() and failure() jobs as GitHub does', () => {
    expect(
      readiness({ needs: ['a'], condition: 'always()' }, [state('a', 'failure')], RUN),
    ).toEqual({ kind: 'start' });
    expect(
      readiness({ needs: ['a'], condition: 'failure()' }, [state('a', 'failure')], RUN),
    ).toEqual({ kind: 'start' });
    expect(
      readiness({ needs: ['a'], condition: 'failure()' }, [state('a', 'success')], RUN),
    ).toEqual({ kind: 'skip' });
    expect(
      readiness({ needs: ['a'], condition: 'success()' }, [state('a', 'success')], {
        ...RUN,
        cancelled: true,
      }),
    ).toEqual({ kind: 'skip' });
  });

  it('evaluates conditions on needs outputs and github', () => {
    const states = [state('build', 'success', { v: '1' })];
    expect(
      readiness(
        { needs: ['build'], condition: "success() && needs.build.outputs.v == '1'" },
        states,
        RUN,
      ),
    ).toEqual({ kind: 'start' });
    expect(readiness({ needs: [], condition: "github.event_name == 'schedule'" }, [], RUN)).toEqual(
      { kind: 'skip' },
    );
    expect(readiness({ needs: [], condition: 'nope(' }, [], RUN)).toMatchObject({ kind: 'error' });
  });

  it('folds matrix legs into one need result, and the run’s conclusion', () => {
    const legs = [state('test', 'success', { a: '1' }), state('test', 'failure', { b: '2' })];
    expect(needResult(legs, 'test')).toEqual({ result: 'failure', outputs: { a: '1', b: '2' } });
    expect(runConclusion([state('a', 'success'), state('b', 'skipped')], false)).toBe('success');
    expect(runConclusion([state('a', 'timed_out'), state('b', 'skipped')], false)).toBe('failure');
    expect(runConclusion([state('a', 'infrastructure_failure')], false)).toBe(
      'infrastructure_failure',
    );
    expect(runConclusion([state('a', 'success'), state('b', null)], false)).toBeNull();
    expect(runConclusion([state('a', 'cancelled')], true)).toBe('cancelled');
  });

  it('plans one job per leg with GitHub’s display names and capped timeouts', async () => {
    const file = await readWorkflowFile(
      '.github/workflows/m.yml',
      `on: push
jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 500
    strategy: { matrix: { node: [20, 22] } }
    steps: [{ run: 'true' }]
  named:
    name: Lint \${{ matrix.tool }}
    runs-on: ubuntu-latest
    strategy: { matrix: { include: [{ tool: eslint }] } }
    steps: [{ run: 'true' }]
`,
      { maxMatrixLegs: 16, maxTimeoutMinutes: 60 },
    );
    let id = 0;
    const jobs = planJobs(file, {
      contexts: RUN.contexts,
      maxTimeoutMinutes: 60,
      newId: () => `job-${(id += 1)}`,
    });
    expect(jobs.map((job) => [job.id, job.name, job.timeoutMinutes])).toEqual([
      ['job-1', 'test (20)', 60],
      ['job-2', 'test (22)', 60],
      ['job-3', 'Lint eslint', 60],
    ]);
  });
});
