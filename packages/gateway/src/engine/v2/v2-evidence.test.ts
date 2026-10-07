import { describe, expect, it } from 'vitest';

import { Sha, TaskId } from '@beanstalk/shared-race/ids';
import type { RunConfigInput } from '@beanstalk/shared-race/run-config';
import { DEMO_SETTINGS } from '@beanstalk/shared-race/run-config';

import { buildSummary } from '../summary';
import { redStalkCommits } from '../testing/burst';
import type { FailRule, World } from '../testing/fake-world';
import type { RaceRun, RaceScenario } from '../testing/scenario';
import { eventsOf, runRace, soloTask, v2StepAfter, wellFormedProblems } from '../testing/scenario';
import { evidenceFor, evidenceState } from './v2-evidence';

const EVIDENCE: Partial<RunConfigInput> = {
  ...DEMO_SETTINGS,
  policy: 'beanstalk-v2',
  agents: 2,
  ci_seconds: 60,
  evidence_promotion: true,
};

const REPORT_TEST = 'src/report/report.test.ts';
const FIXTURE = 'tests/fixtures/rates.json';
const BASE_FILES = {
  'README.md': 'arena\n',
  [REPORT_TEST]: `test('report');\n`,
  [FIXTURE]: '{"rate": 1}\n',
};

function runEvidence(scenario: RaceScenario, config: Partial<RunConfigInput> = {}): RaceRun {
  return runRace({
    baseFiles: BASE_FILES,
    ...scenario,
    config: { ...EVIDENCE, ...config, ...scenario.config },
  });
}

/** Both beans checked on the base side by side, so the second lands without a re-check. */
function sideBySide(rule: FailRule): RaceScenario {
  return {
    tasks: [
      soloTask('t001', {
        writes: {
          'src/t001/index.ts': `export const t001 = 1; // impl:t001 clash:t001\n`,
          [FIXTURE]: '{"rate": 2} // fixture:new-rate\n',
        },
        stubborn: true,
        reexecutions: [{ 'src/t001/index.ts': `export const t001 = 1; // impl:t001\n` }],
      }),
      soloTask('t002', {
        writes: { 'src/t002/index.ts': `export const t002 = 1; // impl:t002 clash:t002\n` },
        stubborn: true,
        reexecutions: [{ 'src/t002/index.ts': `export const t002 = 1; // impl:t002\n` }],
      }),
    ],
    rules: [rule],
    durations: { t001: 20_000, t002: 20_000 },
  };
}

/** The sprout commits holding both beans. */
function commitsWithBoth(run: RaceRun): Set<string> {
  const both = new Set<string>();
  for (const land of eventsOf(run.events, 'land')) {
    const sha = String(land['sha']);
    const tree = run.world.git.get(Sha.parse(sha)).files;
    const text = [...tree.values()].join('\n');
    if (text.includes('clash:t002') && text.includes('fixture:new-rate')) both.add(sha);
    if (text.includes('clash:t001') && text.includes('clash:t002')) both.add(sha);
  }
  return both;
}

describe('v2: promotion by evidence (`evidence_promotion`)', () => {
  it('promotes beans whose checked trees cover every test, without CI', () => {
    const run = runEvidence({
      tasks: [soloTask('t001'), soloTask('t002'), soloTask('t003')],
      durations: { t001: 20_000, t002: 20_000, t003: 20_000 },
      config: { agents: 3 },
    });

    expect(wellFormedProblems(run.events)).toEqual([]);
    const promoted = eventsOf(run.events, 'promote.evidence');
    expect(promoted.length).toBeGreaterThanOrEqual(1);
    for (const event of promoted) {
      expect(event['targeted']).toBeNull();
      expect(Array.isArray(event['checked'])).toBe(true);
    }
    const validations = eventsOf(run.events, 'ci.start', { purpose: 'validate' }).filter(
      (event) => event['audit'] !== true,
    );
    expect(validations).toEqual([]);
    // The audit before the end ran the full suite on the stalk.
    expect(
      eventsOf(run.events, 'ci.end', { purpose: 'validate', audit: true, green: true }),
    ).not.toEqual([]);
    expect(eventsOf(run.events, 'final.check')[0]).toMatchObject({ correct: true });
  });

  it('refuses evidence when two beans meet in a file only a test reads, and validates', () => {
    // t001 changes a fixture only the report test reads; t002 changes code it also reads.
    const run = runEvidence(
      sideBySide({
        markers: ['fixture:new-rate', 'clash:t002'],
        file: REPORT_TEST,
        name: 'the report with the new rate',
        reads: [FIXTURE, 'src/t002/index.ts'],
      }),
    );

    expect(wellFormedProblems(run.events)).toEqual([]);
    const both = commitsWithBoth(run);
    expect(both.size).toBeGreaterThanOrEqual(1);
    const promoted = new Set(
      eventsOf(run.events, 'promote.evidence').map((event) => String(event['sha'])),
    );
    expect([...both].filter((sha) => promoted.has(sha))).toEqual([]);
    const refusal = eventsOf(run.events, 'evidence.refused').find(
      (event) => Array.isArray(event['affected']) && event['affected'].includes(REPORT_TEST),
    );
    expect(refusal).toMatchObject({ reason: 'affected' });
    expect(JSON.stringify(refusal?.['overlaps'])).toContain(FIXTURE);
    expect(eventsOf(run.events, 'ci.end', { purpose: 'validate', green: false })).not.toEqual([]);
    expect(eventsOf(run.events, 'green.demote')).toEqual([]);
    expect(redStalkCommits(run)).toEqual([]);
    expect(eventsOf(run.events, 'final.check')[0]).toMatchObject({ correct: true });
  });

  it('a read set that misses a file lets a red through: the audit catches it and the reset recovers', () => {
    // The report test reads t002's module too, but its read set names only t001's.
    const run = runEvidence(
      sideBySide({
        markers: ['clash:t001', 'clash:t002'],
        file: REPORT_TEST,
        name: 'the report with both',
        reads: ['src/t001/index.ts'],
      }),
    );

    expect(wellFormedProblems(run.events)).toEqual([]);
    const [demote] = eventsOf(run.events, 'green.demote');
    // Back to the first bean, whose own check was reused (a full suite passed its tree).
    expect(demote).toMatchObject({ trunk_idx: 0, from_idx: 1, failing: [REPORT_TEST] });
    expect(
      eventsOf(run.events, 'ci.end', { purpose: 'validate', audit: true, green: false }).length,
    ).toBe(2);
    const reset = eventsOf(run.events, 'sprout.reset');
    expect(reset.length).toBeGreaterThanOrEqual(1);
    expect(Number(reset[0]?.['t'])).toBeGreaterThanOrEqual(Number(demote?.['t']));
    // The one red stalk commit is the one evidence promoted and the audit caught.
    expect(redStalkCommits(run)).toEqual([demote?.['audit_sha']]);
    expect(
      run.state.policy?.kind === 'beanstalk-v2' && run.state.policy.evidence?.distrusted,
    ).toEqual([REPORT_TEST]);
    expect(eventsOf(run.events, 'final.check')[0]).toMatchObject({ correct: true });
  });

  it('takes no evidence from read sets the runner does not mark complete', () => {
    const run = runEvidence({
      tasks: [soloTask('t001'), soloTask('t002')],
      durations: { t001: 20_000, t002: 20_000 },
      wrapWorld: withoutCompleteness,
    });

    expect(eventsOf(run.events, 'promote.evidence')).toEqual([]);
    expect(eventsOf(run.events, 'evidence.refused').map((event) => event['reason'])).toContain(
      'no-read-sets',
    );
    expect(eventsOf(run.events, 'final.check')[0]).toMatchObject({ correct: true });
  });

  it('trusts static read sets with `evidence_read_sets: static`', () => {
    const run = runEvidence(
      {
        tasks: [soloTask('t001'), soloTask('t002')],
        durations: { t001: 20_000, t002: 20_000 },
        wrapWorld: withoutCompleteness,
      },
      { evidence_read_sets: 'static' },
    );

    expect(eventsOf(run.events, 'promote.evidence').length).toBeGreaterThanOrEqual(1);
  });

  it('validates only the affected tests with `affected_validation`', () => {
    const run = runEvidence(
      sideBySide({
        markers: ['fixture:new-rate', 'clash:t002'],
        file: REPORT_TEST,
        name: 'the report with the new rate',
        reads: [FIXTURE, 'src/t002/index.ts'],
      }),
      { affected_validation: true },
    );

    expect(wellFormedProblems(run.events)).toEqual([]);
    const targeted = eventsOf(run.events, 'ci.start', { purpose: 'validate', targeted: true });
    expect(targeted.length).toBeGreaterThanOrEqual(1);
    const jobs = run.world.jobs.filter((job) => job.kind === 'check' && job.only !== undefined);
    expect(
      jobs.some((job) => job.kind === 'check' && job.only?.includes(REPORT_TEST) === true),
    ).toBe(true);
    for (const event of targeted) expect(Number(event['tests'])).toBeLessThan(4);
    expect(redStalkCommits(run)).toEqual([]);
    expect(eventsOf(run.events, 'final.check')[0]).toMatchObject({ correct: true });
  });

  it('reports what it did in the summary', () => {
    const run = runEvidence({ tasks: [soloTask('t001'), soloTask('t002')] });

    const block = buildSummary(run.state, run.env, run.state.clock)['beanstalk'];
    expect(block).toMatchObject({
      evidence_promotion: true,
      evidence_read_sets: 'complete',
      evidence_promotions: eventsOf(run.events, 'promote.evidence').length,
      audits: eventsOf(run.events, 'ci.start', { audit: true }).length,
      audit_reds: 0,
    });
  });
});

/**
 * A finished one-bean race, then t009 (whose check read the report test) and t010 (`files`)
 * landed above the stalk: the evidence for t010's commit.
 */
function judge(files: readonly string[], extra: { structural?: true } = {}) {
  const step = v2StepAfter(runEvidence({ tasks: [soloTask('t001')], config: { agents: 1 } }));
  const { state } = step;
  const evidence = evidenceState(state);
  const report = evidence.sets.length;
  evidence.sets.push([REPORT_TEST, 'src/report/index.ts']);
  // The report test imports its module in every tree the race checked, too.
  for (const [key, voucher] of Object.entries(evidence.vouchers)) {
    evidence.vouchers[key] = { ...voucher, reads: { ...voucher.reads, [REPORT_TEST]: report } };
  }
  const land = (
    task: string,
    landed: { files: readonly string[]; reads: Record<string, number> },
  ) => {
    const candidate = Sha.parse(task.slice(1).padStart(40, 'c'));
    evidence.vouchers[candidate] = {
      sha: candidate,
      kind: 'check',
      task: TaskId.parse(task),
      base: state.commits.length - 1,
      own: [...landed.files],
      reads: landed.reads,
    };
    const idx = state.commits.length;
    const sha = Sha.parse(task.slice(1).padStart(40, 'd'));
    state.commits.push({
      idx,
      sha,
      parent: state.sprout,
      kind: 'task',
      task: TaskId.parse(task),
      ticket: null,
      files: [...landed.files],
      landedAt: 0,
      reverted: false,
      voucher: candidate,
      ...(task === 't010' ? extra : {}),
    });
    state.sprout = sha;
    return idx;
  };
  land('t009', { files: ['src/t009/index.ts'], reads: { [REPORT_TEST]: report } });
  return evidenceFor(state, land('t010', { files, reads: {} }));
}

describe('v2: evidence rules on a hand-built sprout', () => {
  it('vouches for a landing whose files no test reads', () => {
    expect(judge(['src/t010/index.ts']).refusal).toBeNull();
  });

  it('counts a file every test depends on as read by every test', () => {
    const proof = judge(['src/t010/index.ts', 'package.json']);
    expect(proof.refusal).toBe('affected');
    expect(proof.affected).toContain(REPORT_TEST);
  });

  it('counts another resolution of a module a test reads (an added file it probes) as read', () => {
    const proof = judge(['src/t010/index.ts', 'src/report.ts']);
    expect(proof.affected).toContain(REPORT_TEST);
  });

  it('refuses a structural merge whose own tree was never checked', () => {
    expect(judge(['src/t010/index.ts'], { structural: true }).refusal).toBe('structural');
  });
});

/** The runner's static closures: the same read sets, without its word that they are complete. */
function withoutCompleteness(world: World): World {
  return {
    ...world,
    runJob: (spec) => {
      const outcome = world.runJob(spec);
      if (!outcome.ok || outcome.result.kind !== 'check') return outcome;
      const { readSetsComplete: _complete, ...check } = outcome.result.check;
      return { ok: true, result: { kind: 'check', check } };
    },
  };
}
