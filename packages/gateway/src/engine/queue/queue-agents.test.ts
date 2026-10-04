import { describe, expect, it } from 'vitest';

import type { ScriptedTask } from '../testing/fake-world';
import { eventsOf, runRace, soloTask, wellFormedProblems } from '../testing/scenario';

const clashing = (id: string, extra: Partial<ScriptedTask> = {}): ScriptedTask => ({
  id,
  writes: { 'src/shared.ts': `export const owner = '${id}'; // impl:${id}\n` },
  ...extra,
});

const buggy = (id: string): ScriptedTask => ({
  id,
  writes: { [`src/${id}/index.ts`]: `export const ${id} = 'BUG:${id}'; // impl:${id}\n` },
});

describe('queue race: sessions, budget and drivers', () => {
  it('resumes the author session for a Claude rework', () => {
    const race = runRace({
      tasks: [clashing('t001'), clashing('t002')],
      config: { agent: 'claude' },
    });

    const rework = race.world.instructions.find((instruction) => instruction.kind === 'rework');
    expect(rework?.resume).toMatch(/^session-t00[12]$/);
    expect(rework?.prompt.startsWith('Your change could not be merged')).toBe(true);
    expect(eventsOf(race.events, 'rework.start')[0]).toMatchObject({ resumed: true });
    expect(eventsOf(race.events, 'invocation.start', { kind: 'rework' })[0]?.['resume']).toMatch(
      /^session-/,
    );
  });

  it('never resumes a replay agent, which has no sessions to resume', () => {
    const race = runRace({ tasks: [clashing('t001'), clashing('t002')] });

    const rework = race.world.instructions.find((instruction) => instruction.kind === 'rework');
    expect(rework?.resume).toBeNull();
    expect(rework?.prompt.startsWith('You are working on: Task t00')).toBe(true);
  });

  it('retries a failed resume at once as a fresh session with the full prompt', () => {
    const race = runRace({
      tasks: [clashing('t001', { failsResume: true }), clashing('t002', { failsResume: true })],
      config: { agent: 'claude' },
    });

    const retry = eventsOf(race.events, 'invocation.retry')[0];
    expect(retry?.['reason']).toBe('resume failed: No conversation found with session ID');
    const reworks = race.world.instructions.filter((instruction) => instruction.kind === 'rework');
    expect(reworks.map((instruction) => instruction.resume === null)).toEqual([false, true]);
    expect(reworks[1]?.prompt.startsWith('You are working on:')).toBe(true);
    expect(reworks[1]?.workspace.merge).toEqual(reworks[0]?.workspace.merge);
    expect(Object.values(race.state.tasks).every((task) => task.status === 'green')).toBe(true);
  });

  it('aborts mid-invocation when a progress estimate crosses the budget', () => {
    const race = runRace({
      tasks: [soloTask('t001')],
      config: { agents: 1 },
      durations: { t001: 30_000 },
      injections: [
        {
          at: 10_000,
          input: (at) => ({
            kind: 'progress',
            at,
            slot: 'a0',
            inv: 'inv0001-initial',
            costUsd: 30,
          }),
        },
      ],
    });

    expect(race.state.aborted).toBe('budget: $30.00 of $25.00 (mid-invocation)');
    const killed = eventsOf(race.events, 'invocation.end', { inv: 'inv0001-initial' })[0];
    expect(killed).toMatchObject({
      ok: false,
      killed: true,
      cost_usd: 30,
      cost_source: 'estimated',
    });
    expect(wellFormedProblems(race.events)).toEqual([]);
  });

  it('closes an invocation whose driver went silent as a lost agent and retries it', () => {
    const race = runRace({
      tasks: [soloTask('t001')],
      config: { agents: 1, agent_timeout: 60 },
      lostInvocations: ['inv0001-initial'],
    });

    const lost = eventsOf(race.events, 'invocation.end', { inv: 'inv0001-initial' })[0];
    expect(lost?.['infra_error']).toBe('lost: no result from the driver within 360 s');
    expect(eventsOf(race.events, 'invocation.retry')).toHaveLength(1);
    expect(race.state.tasks['t001']?.status).toBe('green');
  });

  it('hands landed tasks acceptance tests to the driver with protect_tests=landed', () => {
    const race = runRace({
      tasks: [soloTask('t001'), soloTask('t002')],
      config: { agents: 1, protect_tests: 'landed' },
    });

    const second = race.world.instructions.find((instruction) => instruction.task === 't002');
    expect(second?.workspace.protect).toEqual([
      { path: 'tests/t001.test.ts', content: "test('t001');\n" },
    ]);
    const first = race.world.instructions.find((instruction) => instruction.task === 't001');
    expect(first?.workspace.protect).toEqual([]);
  });

  it('gives the driver everything it needs to set up the worktree', () => {
    const race = runRace({
      tasks: [soloTask('t001')],
      config: { agents: 1, merge_drivers: 'union' },
    });

    expect(race.world.instructions[0]).toMatchObject({
      inv: 'inv0001-initial',
      kind: 'initial',
      task: 't001',
      slot: 'a0',
      attempt: 1,
      resume: null,
      adapter: 'replay',
      max_turns: 40,
      timeout_seconds: 900,
      budget_cap_usd: 3,
      workspace: {
        repoKey: 't001',
        branch: 'beans/t001',
        baseSha: race.world.baseSha,
        headSha: null,
        merge: null,
        acceptance: { 'tests/t001.test.ts': "test('t001');\n" },
        unionPaths: ['CHANGELOG.md', 'CHANGELOG*.md', '**/CHANGELOG.md'],
        commitMessage: 'Task t001\n\nTask: t001\nKind: initial\nInvocation: inv0001-initial\n',
      },
      replay: { reset_to: null, check: null, fixes: [] },
    });
  });
});

describe('queue race: speculation and semantic clashes', () => {
  it('cancels the speculative batch stacked on a red one and requeues its PR', () => {
    const race = runRace({
      tasks: [buggy('t001'), soloTask('t002'), soloTask('t003')],
      rules: [{ markers: ['BUG:t001'], file: 'tests/t001.test.ts', name: 't001 works' }],
      config: { agents: 3, batch: 1, ci_slots: 2 },
      durations: { t001: 10_000, t002: 20_000, t003: 30_000 },
    });

    expect(wellFormedProblems(race.events)).toEqual([]);
    const cancel = eventsOf(race.events, 'batch.cancel')[0];
    expect(cancel).toMatchObject({ batch: 'b002', tasks: ['t002'], because: 'b001' });
    expect(eventsOf(race.events, 'ci.end', { cancelled: true, batch: 'b002' })).toHaveLength(1);
    expect(eventsOf(race.events, 'batch.start')[1]).toMatchObject({ speculative: true });
    expect(eventsOf(race.events, 'final.check')[0]).toMatchObject({
      correct: true,
      all_tasks_accepted: true,
    });
  });

  it('finds the PR that breaks the suite only together with another', () => {
    const race = runRace({
      tasks: [buggy('t001'), buggy('t002')],
      rules: [
        { markers: ['BUG:t001', 'BUG:t002'], file: 'tests/t001.test.ts', name: 'they agree' },
      ],
      config: { agents: 2, batch: 2, batch_wait: 3600 },
      durations: { t001: 10_000, t002: 20_000 },
    });

    expect(eventsOf(race.events, 'bisect.end')[0]).toMatchObject({
      culprit: 't002',
      landed: ['t001'],
    });
    expect(eventsOf(race.events, 'rework.start', { task: 't002', reason: 'red' })).toHaveLength(1);
    expect(eventsOf(race.events, 'final.check')[0]).toMatchObject({ correct: true });
  });
});
