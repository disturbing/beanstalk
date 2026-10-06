import { describe, expect, it } from 'vitest';

import type { InvocationKind } from './driver';
import { INVOCATION_KINDS, InvocationId } from './ids';

type KindsMatch = [InvocationKind] extends [(typeof INVOCATION_KINDS)[number]]
  ? [(typeof INVOCATION_KINDS)[number]] extends [InvocationKind]
    ? true
    : never
  : never;
const kindsMatch: KindsMatch = true;

describe('InvocationId', () => {
  it('lists exactly the kinds the driver contract has', () => {
    expect(kindsMatch).toBe(true);
  });

  it.each(INVOCATION_KINDS)('accepts an id of kind %s', (kind) => {
    expect(InvocationId.parse(`inv0012-${kind}`)).toBe(`inv0012-${kind}`);
  });

  it('rejects an unknown kind', () => {
    expect(InvocationId.safeParse('inv0012-bogus').success).toBe(false);
  });
});
