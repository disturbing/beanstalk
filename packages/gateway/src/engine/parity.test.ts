import { describe, expect, it } from 'vitest';

import type { RunConfigInput } from '@beanstalk/shared-race/run-config';
import { V20_SETTINGS } from '@beanstalk/shared-race/run-config';

import type { FailRule, ScriptedTask } from './testing/fake-world';
import type { LooseEvent, RaceScenario } from './testing/scenario';
import { runRace, soloTask } from './testing/scenario';

/**
 * Replay parity. With the v2.0 settings (file-level re-checks, the agent bound to its bean
 * until it lands, no re-run before a revert, every red check the bean's, declined losers, no
 * sprout window, no early tickets, no reconcile)
 * the engine must decide exactly as it did before the v2.2 rules, so cloud runs stay
 * comparable with the harness's v2 races. The digests below were recorded from the engine
 * before v2.2; the queue is pinned too.
 */
const V20_KNOBS: Partial<RunConfigInput> = V20_SETTINGS;

const V2: Partial<RunConfigInput> = { policy: 'beanstalk-v2', agents: 2, ci_seconds: 60 };

const BREAKS_T001: FailRule = {
  markers: ['impl:t001', 'BUG:t002'],
  file: 'tests/t001.test.ts',
  name: 't001 keeps working',
  reads: ['src/t001/index.ts'],
};

const CLASH: FailRule = {
  markers: ['impl:t001', 'impl:t002'],
  file: 'tests/clash.test.ts',
  name: 'both features together',
  reads: ['src/t001/index.ts', 'src/t002/index.ts'],
};

function buggyT002(extra: Partial<ScriptedTask> = {}): ScriptedTask {
  return soloTask('t002', {
    writes: { 'src/t002/index.ts': 'export const t002 = 1; // impl:t002 BUG:t002\n' },
    ...extra,
  });
}

function changelogTask(id: string): ScriptedTask {
  return soloTask(id, {
    writes: {
      [`src/${id}/index.ts`]: `export const ${id} = 1; // impl:${id}\n`,
      'CHANGELOG.md': `changelog\n${id} entry\n`,
    },
  });
}

function sharedFileTask(id: string): ScriptedTask {
  return soloTask(id, {
    writes: { 'src/shared.ts': `export const owner = '${id}'; // impl:${id}\n` },
  });
}

function v2(scenario: RaceScenario): RaceScenario {
  return { ...scenario, config: { ...V2, ...scenario.config, ...V20_KNOBS } };
}

const SCENARIOS: Readonly<Record<string, RaceScenario>> = {
  'v2 clean': v2({ tasks: [soloTask('t001')], config: { agents: 1 } }),
  'v2 optimistic landing': v2({
    tasks: [soloTask('t001'), soloTask('t002')],
    durations: { t001: 30_000, t002: 20_000 },
  }),
  'v2 re-check': v2({
    tasks: [changelogTask('t001'), changelogTask('t002')],
    baseFiles: { 'README.md': 'arena\n', 'CHANGELOG.md': 'changelog\n' },
    durations: { t001: 30_000, t002: 20_000 },
  }),
  'v2 conflict rework': v2({
    tasks: [sharedFileTask('t001'), sharedFileTask('t002')],
    durations: { t001: 20_000, t002: 100_000 },
  }),
  'v2 informed rework': v2({
    tasks: [soloTask('t001'), buggyT002()],
    rules: [BREAKS_T001],
    durations: { t001: 20_000, t002: 100_000 },
  }),
  'v2 declined card': v2({
    tasks: [soloTask('t001'), buggyT002({ stubborn: true })],
    rules: [BREAKS_T001],
    durations: { t001: 20_000, t002: 100_000 },
  }),
  'v2 revert-first': v2({
    tasks: [soloTask('t001'), soloTask('t002')],
    rules: [CLASH],
    durations: { t001: 30_000, t002: 20_000 },
  }),
  'v2 bisect then revert': v2({
    tasks: [soloTask('t001'), soloTask('t002'), soloTask('t003')],
    rules: [CLASH],
    durations: { t001: 25_000, t002: 20_000, t003: 30_000 },
    config: { agents: 3, ci_slots: 1 },
  }),
  'v2 mixed, seed 11': v2({
    tasks: [soloTask('t001'), buggyT002(), soloTask('t003')],
    rules: [BREAKS_T001],
    seed: 11,
  }),
  'queue clean': { tasks: ['t001', 't002', 't003', 't004'].map((id) => soloTask(id)) },
  'queue red batch': {
    tasks: [soloTask('t001'), buggyT002(), soloTask('t003'), soloTask('t004')],
    rules: [BREAKS_T001],
    config: { batch: 4 },
  },
};

/** Event count and SHA-256 of the event stream, per scenario, from the engine before v2.2. */
const GOLDEN: Readonly<Record<string, { events: number; sha256: string }>> = {
  'v2 clean': {
    events: 19,
    sha256: '37b436f5afeaea228f7cbeb29d4a47a6448524334135afaea4b6e5d1958126b7',
  },
  'v2 optimistic landing': {
    events: 31,
    sha256: 'e86f893335dea38f70efe66d12758274c2e79a04f3c7e206d8f4641508323e45',
  },
  'v2 re-check': {
    events: 32,
    sha256: '66f6469174eb0d5083f063bfef1ccd6d089b345eeafa06df90fedca8abdbe360',
  },
  'v2 conflict rework': {
    events: 35,
    sha256: '400a60d9c9f333acf94e1a591d81ac43254addb05e5aa99c6fb414b147e5c4f9',
  },
  'v2 informed rework': {
    events: 35,
    sha256: '4c0810d8a28d2c74a6fc736a42a1fa70b14376ce3bd7258781659787c249d010',
  },
  'v2 declined card': {
    events: 39,
    sha256: '7f0e9dcdfb726d9f56ca2088ac235361fcab57841ad46727d4dfa279faad325a',
  },
  'v2 revert-first': {
    events: 38,
    sha256: 'f1d398145915376c4007a894c212f867929cc2ce2a9ce602156e951a79363f1f',
  },
  'v2 bisect then revert': {
    events: 49,
    sha256: 'c97b2de1e67830a0347aecaca46d90861e3b252c0ccbc1955e09820d78a77753',
  },
  'v2 mixed, seed 11': {
    events: 54,
    sha256: '249dd848ccbc09a5e38e243c82a93d25cec401f8a1086d391eb72717686476b3',
  },
  'queue clean': {
    events: 52,
    sha256: '85776b33afd824c6a0a26c7aeebe35a47c7414633ac1a7527b94fe984d537e88',
  },
  'queue red batch': {
    events: 83,
    sha256: '70f60383ddc696e9b40be112ed7c8ea6fd313086beb0aaf3222011ddda481695',
  },
};

async function digest(events: readonly LooseEvent[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(events));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

describe('replay parity with the v2.0 engine', () => {
  it('decides every scenario exactly as before', async () => {
    const actual: Record<string, { events: number; sha256: string }> = {};
    for (const [name, scenario] of Object.entries(SCENARIOS)) {
      const run = runRace(scenario);
      // oxlint-disable-next-line no-await-in-loop -- one digest per scenario, in order
      actual[name] = { events: run.events.length, sha256: await digest(run.events) };
    }

    expect(actual).toEqual(GOLDEN);
  });
});
