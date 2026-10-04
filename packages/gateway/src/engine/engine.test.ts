import { describe, expect, it } from 'vitest';

import { Sha } from '@beanstalk/shared-race/ids';
import { RunConfig } from '@beanstalk/shared-race/run-config';

import { engineEnv } from './catalog';
import { step } from './engine';
import { initialEngineState } from './lifecycle';
import type { EngineInput, EngineResponse, JobId } from './model';
import type { EngineState } from './state';
import { agentResult } from './testing/fake-world';

const T0 = Date.UTC(2026, 9, 3, 12, 0, 0);
const BASE = Sha.parse('a'.repeat(40));
const env = engineEnv(
  RunConfig.parse({
    policy: 'queue',
    agents: 2,
    tasks: [
      {
        id: 't001',
        title: 'One',
        prompt: 'Do one.',
        acceptance_tests: { 'tests/t001.test.ts': 'x' },
      },
    ],
  }),
);

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

function run(inputs: readonly EngineInput[]): {
  state: EngineState;
  responses: EngineResponse[];
  replies: unknown[];
} {
  let state = initialEngineState(env, T0);
  const responses: EngineResponse[] = [];
  const replies: unknown[] = [];
  for (const input of inputs) {
    const output = step(state, input, env);
    state = output.state;
    responses.push(output.response);
    replies.push(...output.effects.replies);
  }
  return { state, responses, replies };
}

const start: EngineInput = {
  kind: 'start',
  at: T0 + 1000,
  baseSha: BASE,
  labels: { out: 'x', repo: 'race-x' },
};

const poll: EngineInput = { kind: 'poll', at: T0 + 10, slot: 'a0', pollId: 'p1' };

/** t001's initial invocation reports a commit: the queue squashes it (job1). */
const committed: EngineInput = {
  kind: 'result',
  at: T0 + 2000,
  slot: 'a0',
  inv: 'inv0001-initial',
  result: agentResult({ ok: true, head_sha: Sha.parse('b'.repeat(40)), session_id: 's1' }),
};

/** The squash is clean: the batch goes to CI (job2). */
const squashed: EngineInput = {
  kind: 'job-done',
  at: T0 + 3000,
  jobId: 'job1',
  outcome: {
    ok: true,
    result: {
      kind: 'squash',
      outcome: 'clean',
      sha: Sha.parse('c'.repeat(40)),
      files: ['src/a.ts'],
      changeFiles: ['src/a.ts'],
    },
  },
};

const failed = (jobId: JobId, at: number): EngineInput => ({
  kind: 'job-done',
  at,
  jobId,
  outcome: { ok: false, error: 'artifacts unavailable', retryable: true },
});

/** A job failing on its first attempt and on every retry. */
const failures = (jobId: JobId, from: number): EngineInput[] =>
  Array.from({ length: 6 }, (_, index) => failed(jobId, from + index * 60_000));

describe('step', () => {
  it('never mutates the state it is given', () => {
    const state = deepFreeze(initialEngineState(env, T0));

    const output = step(state, start, env);

    expect(output.state.phase).toBe('running');
    expect(state.phase).toBe('created');
  });

  it('holds polls before the start and refuses a second start', () => {
    const { responses } = run([
      { kind: 'poll', at: T0 + 10, slot: 'a0', pollId: 'p1' },
      start,
      start,
    ]);

    expect(responses[0]).toEqual({ kind: 'poll', reply: null });
    expect(responses[2]).toMatchObject({ kind: 'refused', refusal: { code: 'invalid_state' } });
  });

  it('answers a superseded poll with wait', () => {
    const { replies } = run([
      { kind: 'poll', at: T0 + 10, slot: 'a1', pollId: 'p1' },
      { kind: 'poll', at: T0 + 20, slot: 'a1', pollId: 'p2' },
    ]);

    expect(replies).toEqual([{ pollId: 'p1', reply: { wait: true } }]);
  });

  it('delivers the first instruction at once: the bean is a branch of the run repo', () => {
    const output = step(run([poll]).state, start, env);

    expect(output.effects.jobs).toEqual([]);
    expect(output.effects.replies).toMatchObject([
      {
        pollId: 'p1',
        reply: { invocation: { inv: 'inv0001-initial', workspace: { branch: 'beans/t001' } } },
      },
    ]);
  });

  it('refuses results for invocations of another slot, unknown ones and closed ones', () => {
    const delivered = run([poll, start]);
    expect(delivered.replies).toHaveLength(1);
    const result = agentResult({ ok: true, head_sha: Sha.parse('b'.repeat(40)) });

    const wrongSlot = step(
      delivered.state,
      { kind: 'result', at: T0 + 3000, slot: 'a1', inv: 'inv0001-initial', result },
      env,
    );
    const unknown = step(
      delivered.state,
      { kind: 'result', at: T0 + 3000, slot: 'a0', inv: 'inv0099-rework', result },
      env,
    );
    const accepted = step(
      delivered.state,
      { kind: 'result', at: T0 + 3000, slot: 'a0', inv: 'inv0001-initial', result },
      env,
    );
    const again = step(
      accepted.state,
      { kind: 'result', at: T0 + 3100, slot: 'a0', inv: 'inv0001-initial', result },
      env,
    );

    expect(wrongSlot.response).toMatchObject({ kind: 'refused', refusal: { code: 'wrong_slot' } });
    expect(unknown.response).toMatchObject({
      kind: 'refused',
      refusal: { code: 'unknown_invocation' },
    });
    expect(accepted.response).toEqual({ kind: 'accepted' });
    expect(again.response).toMatchObject({
      kind: 'refused',
      refusal: { code: 'closed_invocation' },
    });
  });

  it('answers polls with done once the run is over', () => {
    const stopped = run([{ kind: 'stop', at: T0 + 10, reason: 'never mind' }]);
    const output = step(
      stopped.state,
      { kind: 'poll', at: T0 + 20, slot: 'a0', pollId: 'p9' },
      env,
    );

    expect(output.response).toEqual({ kind: 'poll', reply: { done: true, aborted: 'never mind' } });
  });

  it('turns a fault into an error event and an abort', () => {
    const { state } = run([
      start,
      { kind: 'fault', at: T0 + 2000, where: 'shell', error: 'boom', traceback: 'at x' },
    ]);

    expect(state.aborted).toBe('error in shell: boom');
    expect(state.phase).toBe('finishing');
  });

  it('retries a failed job with backoff', () => {
    const once = run([poll, start, committed, failed('job1', T0 + 3000)]);

    expect(once.state.jobs['job1']?.attempts).toBe(2);
    expect(Object.values(once.state.timers).map((timer) => timer.purpose.kind)).toContain(
      'job-retry',
    );
  });

  it('drops only the task whose own job keeps failing; the race goes on', () => {
    const { state } = run([poll, start, committed, ...failures('job1', T0 + 3000)]);

    expect(state.aborted).toBeNull();
    expect(state.tasks['t001']).toMatchObject({
      status: 'dropped',
      dropReason: 'infrastructure failure: squash failed: artifacts unavailable',
    });
  });

  it('aborts when a job the whole race depends on keeps failing', () => {
    const { state } = run([poll, start, committed, squashed, ...failures('job2', T0 + 4000)]);

    expect(state.aborted).toBe('check failed: artifacts unavailable');
  });
});
