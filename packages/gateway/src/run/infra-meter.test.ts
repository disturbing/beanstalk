import { describe, expect, it } from 'vitest';

import {
  INFRA_PRICES,
  countAlarm,
  countArtifactsOps,
  countRequest,
  emptyMeter,
  infraReport,
  recordRunnerCall,
} from './infra-meter';

describe('the infra meter', () => {
  it('counts an instance’s up time once when calls overlap its sleepAfter tail', () => {
    const first = recordRunnerCall(emptyMeter(0), { instance: 'ci-0', startMs: 0, endMs: 10_000 });
    const overlapping = recordRunnerCall(first, {
      instance: 'ci-0',
      startMs: 60_000,
      endMs: 70_000,
    });
    const otherInstance = recordRunnerCall(overlapping, {
      instance: 'ci-1',
      startMs: 60_000,
      endMs: 70_000,
    });

    expect(first.containerUpSeconds).toBe(130);
    expect(overlapping.containerUpSeconds).toBe(190);
    expect(otherInstance.containerUpSeconds).toBe(320);
    expect(otherInstance.containerBusySeconds).toBe(30);
    expect(otherInstance.artifactsOps).toBe(3);
  });

  it('prices each product at its list rate', () => {
    let meter = countArtifactsOps(emptyMeter(0), 1000);
    meter = countRequest(countRequest(meter, 500), 1000);
    meter = countAlarm(meter, 1000);

    const report = infraReport(meter, 0);

    expect(report).toMatchObject({ worker_requests: 2, do_requests: 3, artifacts_ops: 1000 });
    expect(report.usd.artifacts).toBeCloseTo(0.15, 6);
    expect(report.usd.workers).toBeCloseTo(2 * INFRA_PRICES.workerRequestUsd, 9);
    expect(report.usd.total).toBeCloseTo(
      report.usd.workers + report.usd.durable_objects + report.usd.artifacts,
      6,
    );
  });
});
