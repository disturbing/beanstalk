import { describe, expect, it } from 'vitest';

import { Sha } from '@beanstalk/shared-race/ids';
import { RunConfig } from '@beanstalk/shared-race/run-config';

import { engineEnv } from './catalog';
import { createContext } from './context';
import type { StepContext } from './context';
import { step } from './engine';
import { EngineInvariantError } from './errors';
import { closeWithResult, createInvocation, toInstruction } from './invocations';
import { initialEngineState } from './lifecycle';
import type { OpenInvocation } from './model';
import { taskWorkspace } from './tasks';
import { agentResult } from './testing/fake-world';

const T0 = Date.UTC(2026, 9, 6, 12, 0, 0);
const BASE = Sha.parse('a'.repeat(40));
const LANDED = Sha.parse('c'.repeat(40));

const env = engineEnv(
  RunConfig.parse({
    policy: 'queue',
    agents: 2,
    protect_tests: 'landed',
    tasks: ['t001', 't002'].map((id) => ({
      id,
      title: id,
      prompt: `Do ${id}.`,
      acceptance_tests: { [`tests/${id}.test.ts`]: `test('${id}');\n` },
    })),
  }),
);

/** A running race whose t002 has landed and whose t001 has started from the base. */
function racing(): StepContext {
  const started = step(
    initialEngineState(env, T0),
    { kind: 'start', at: T0 + 1000, baseSha: BASE, labels: { out: 'x', repo: 'race-x' } },
    env,
  ).state;
  const ctx = createContext(structuredClone(started), T0 + 2000, env);
  const [t001, t002] = [ctx.state.tasks['t001'], ctx.state.tasks['t002']];
  if (t001 === undefined || t002 === undefined) throw new Error('tasks missing');
  t001.baseSha = BASE;
  t002.landedSha = LANDED;
  return ctx;
}

function invocationOf(ctx: StepContext, kind: 'initial' | 'rework'): OpenInvocation {
  const task = ctx.state.tasks['t001'];
  if (task === undefined) throw new Error('t001 missing');
  const id = createInvocation(ctx, {
    kind,
    task: 't001',
    slot: 'a0',
    attempt: 1,
    prompt: 'resume prompt',
    freshPrompt: kind === 'initial' ? 'resume prompt' : 'fresh prompt',
    resume: null,
    workspace: (inv) => taskWorkspace(ctx, task, { kind, inv, merge: null }),
    replay: { reset_to: null, check: null, fixes: [] },
  });
  const inv = id === null ? undefined : ctx.state.invocations[id];
  if (inv === undefined) throw new Error('no invocation');
  return inv;
}

describe('an open invocation', () => {
  it('stores landed tests by reference and delivers their contents', () => {
    const ctx = racing();
    const inv = invocationOf(ctx, 'initial');

    expect(inv.workspace.protect).toEqual([{ task: 't002', path: 'tests/t002.test.ts' }]);
    expect(toInstruction(ctx, inv).workspace.protect).toEqual([
      { path: 'tests/t002.test.ts', content: "test('t002');\n" },
    ]);
  });

  it('stores the fresh prompt only when it differs from the prompt', () => {
    const ctx = racing();

    expect(invocationOf(ctx, 'initial').freshPrompt).toBeNull();
    ctx.state.slots.forEach((slot) => {
      slot.outbox = null;
    });
    expect(invocationOf(ctx, 'rework').freshPrompt).toBe('fresh prompt');
  });

  it('delivers the test files a state stored before references held', () => {
    const ctx = racing();
    const inv = invocationOf(ctx, 'initial');
    const stored = { path: 'tests/t002.test.ts', content: 'the landed version' };
    const older: OpenInvocation = { ...inv, workspace: { ...inv.workspace, protect: [stored] } };

    expect(toInstruction(ctx, older).workspace.protect).toEqual([stored]);
  });

  it('refuses a second undelivered invocation for one slot', () => {
    const ctx = racing();
    invocationOf(ctx, 'initial');

    expect(() => invocationOf(ctx, 'rework')).toThrow(EngineInvariantError);
  });
});

describe('invocation.end', () => {
  it('records the paths the driver’s merge left conflicted, when it reported any', () => {
    const ctx = racing();
    const conflicted = invocationOf(ctx, 'initial');
    closeWithResult(ctx, conflicted, agentResult({ ok: true, merge_conflicts: ['src/a.ts'] }));
    const clean = invocationOf(ctx, 'initial');
    closeWithResult(ctx, clean, agentResult({ ok: true }));

    const ends = ctx.effects.events.filter((event) => event.type === 'invocation.end');
    expect(
      ends.map((event) => ('merge_conflicts' in event ? event.merge_conflicts : null)),
    ).toEqual([['src/a.ts'], null]);
  });
});
