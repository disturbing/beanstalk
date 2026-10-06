/**
 * The live Ask path's round trips (`docs/claude-opus/14` §11), timed on a simulated gateway
 * (`testing/simulated-gateway.ts`): the gateway's own explorer over a recorded run's repo, a
 * fixed latency per Artifacts call and per RPC hop, under fake timers. The model that
 * reproduces the 22 s measured on a live run before the fix is a repo answering one call at
 * a time at 70 ms a call; the targets are checked under it and under overlapping calls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { keywordClassifier } from '@beanstalk/shared-ask/ask/classifier';
import { planAnswer } from '@beanstalk/shared-ask/ask/plan-answer';
import { gatewaySource } from '@beanstalk/shared-ask/forge/gateway-source';
import { memoSource } from '@beanstalk/shared-ask/forge/memo-source';
import { rulesPicker } from '@beanstalk/shared-ask/pick/picker';
import { featuredBean } from '../server/featured-bean';
import { homePageData } from '../server/home-page-data';
import { calibrationRun } from './testing/calibration-run';
import type { ReadPath, SimulatedGateway, SimulatedLatency } from './testing/simulated-gateway';
import { simulatedGateway } from './testing/simulated-gateway';

const calibration = calibrationRun();
const run = calibration.run;
const QUESTION = 'what changed recently on coupons?';
/** Calls in the repo one at a time, 70 ms each: 21.6 s before the fix, as measured live. */
const CALIBRATED: SimulatedLatency = { artifactsMs: 70, hopMs: 5, artifacts: 'serial' };
const OVERLAPPING: SimulatedLatency = { artifactsMs: 70, hopMs: 5, artifacts: 'parallel' };
/** Past the read index's memo of refs: the sprout is resolved from Artifacts again. */
const LATER_MS = 6000;

function gateway(latency: SimulatedLatency, readPath: ReadPath = 'objects') {
  return simulatedGateway(calibration, latency, readPath);
}

function artifactsCalls(sim: SimulatedGateway): number {
  return [...sim.counts.artifacts.values()].reduce((sum, count) => sum + count, 0);
}

/**
 * The repository home with the question, read as the page reads it: the home's data, the
 * answer, the featured bean. `per-call` is the page before fix 1 (a fresh source per part).
 */
async function askPage(sim: SimulatedGateway, sources: 'per-request' | 'per-call' = 'per-request') {
  const shared = memoSource(gatewaySource(sim.binding));
  const source = () => (sources === 'per-request' ? shared : gatewaySource(sim.binding));
  const callsBefore = artifactsCalls(sim);
  const started = Date.now();
  const flow = (async () => {
    await homePageData(source(), run);
    const answer = await planAnswer({
      source: source(),
      run,
      question: QUESTION,
      classifier: keywordClassifier,
      removed: [],
      ref: null,
      selection: { file: null, bean: null, view: null },
      picker: rulesPicker,
    });
    const featured = await featuredBean(source(), run, answer, null);
    return { answer, featured };
  })();
  await vi.runAllTimersAsync();
  const result = await flow;
  return { ...result, ms: Date.now() - started, calls: artifactsCalls(sim) - callsBefore };
}

/** A run whose every landing warmed the read index, as the RunDO does. */
async function warmedGateway(latency: SimulatedLatency) {
  const sim = gateway(latency);
  const warming = sim.warmLandings();
  await vi.runAllTimersAsync();
  await warming;
  await vi.advanceTimersByTimeAsync(LATER_MS);
  return sim;
}

describe('the coupons question on a live run (simulated gateway)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ loopLimit: 1_000_000 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('took about 22 s before the fixes, as measured on the live gateway', async () => {
    const before = await askPage(gateway(CALIBRATED, 'none'), 'per-call');

    expect(before.ms).toBeGreaterThan(20_000);
    expect(before.ms).toBeLessThan(23_000);
    expect(before.calls).toBeGreaterThan(300);
  });

  it('shares reads within the request: fewer calls, the same answer (fix 1)', async () => {
    const before = await askPage(gateway(CALIBRATED, 'none'), 'per-call');
    const memoised = await askPage(gateway(CALIBRATED, 'none'));

    expect(memoised.calls).toBeLessThan(before.calls);
    expect(memoised.answer).toEqual(before.answer);
    expect(memoised.featured).toEqual(before.featured);
  });

  it('answers in under 5 s once landings have warmed the read index (fix 2)', async () => {
    const calibrated = await askPage(await warmedGateway(CALIBRATED));
    const overlapping = await askPage(await warmedGateway(OVERLAPPING));

    expect(calibrated.ms).toBeLessThan(5000);
    expect(overlapping.ms).toBeLessThan(5000);
    expect(calibrated.calls).toBeLessThanOrEqual(4);
  });

  it('answers a repeated question in under 1 s', async () => {
    const sim = await warmedGateway(CALIBRATED);
    await askPage(sim);
    const soon = await askPage(sim);
    await vi.advanceTimersByTimeAsync(LATER_MS);
    const later = await askPage(sim);

    expect(soon.ms).toBeLessThan(1000);
    expect(later.ms).toBeLessThan(1000);
  });

  it('fills the index on a run that was never warmed, so only its first question pays', async () => {
    const sim = gateway(CALIBRATED);
    const cold = await askPage(sim);
    await vi.advanceTimersByTimeAsync(LATER_MS);
    const next = await askPage(sim);

    expect(cold.ms).toBeLessThan(15_000);
    expect(next.ms).toBeLessThan(1000);
  });

  it('gives the same answer through the read index as straight from Artifacts', async () => {
    const direct = await askPage(gateway(OVERLAPPING, 'none'));
    const indexed = await askPage(await warmedGateway(OVERLAPPING));

    expect(indexed.answer).toEqual(direct.answer);
    expect(indexed.featured).toEqual(direct.featured);
    expect(indexed.answer.fileSet.length).toBeGreaterThan(0);
  });
});
