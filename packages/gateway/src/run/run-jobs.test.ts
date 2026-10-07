import { describe, expect, it } from 'vitest';

import { Sha } from '@beanstalk/shared-race/ids';

import type { JobSpec } from '../engine/model';
import { readMapOptions } from './run-jobs';

type CheckSpec = Extract<JobSpec, { kind: 'check' }>;

const PRELAND: CheckSpec = {
  kind: 'check',
  sha: Sha.parse('a'.repeat(40)),
  extraFiles: null,
  instance: { kind: 'sandbox', slot: 'a0' },
};
const VALIDATION: CheckSpec = { ...PRELAND, instance: { kind: 'ci', slot: 0 } };

describe('readMapOptions', () => {
  it('traces pre-land checks only, and asks validations for their manifest, under preland', () => {
    expect(readMapOptions(PRELAND, 'preland')).toEqual({ trace: true, treeManifest: true });
    expect(readMapOptions(VALIDATION, 'preland')).toEqual({ trace: false, treeManifest: true });
  });

  it('traces a validation that asks for every read set (evidence), unless off', () => {
    expect(readMapOptions({ ...VALIDATION, allReadSets: true }, 'preland').trace).toBe(true);
    expect(readMapOptions({ ...VALIDATION, allReadSets: true }, 'off').trace).toBe(false);
  });

  it('traces every check under all and none under off', () => {
    expect(readMapOptions(VALIDATION, 'all')).toEqual({ trace: true, treeManifest: true });
    expect(readMapOptions(PRELAND, 'off')).toEqual({ trace: false, treeManifest: false });
  });

  it("lets a job's own choice win", () => {
    expect(readMapOptions({ ...VALIDATION, trace: true }, 'off').trace).toBe(true);
    expect(readMapOptions({ ...PRELAND, trace: false }, 'all').trace).toBe(false);
  });
});
