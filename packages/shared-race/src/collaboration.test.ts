import { describe, expect, it } from 'vitest';

import { BeanThreadPostInput, BeanUpdateInput, ContributorTokenClaims } from './collaboration';

const update = {
  bean: 'shipping',
  expected_revision: 0,
  changes: {
    approach: { summary: 'Keep the existing field compatible', paths: ['src/shipping.ts'] },
  },
  idempotency_key: 'approach-1',
};

describe('collaboration contracts', () => {
  it('rejects forged ownership fields and paths outside the repository', () => {
    expect(BeanUpdateInput.safeParse({ ...update, actor: 'other-agent' }).success).toBe(false);
    expect(
      BeanUpdateInput.safeParse({
        ...update,
        changes: {
          approach: {
            summary: 'Rewrite',
            paths: ['../outside.ts'],
          },
        },
      }).success,
    ).toBe(false);
  });

  it('requires explicit response and exact promise revision for acceptance', () => {
    const accept = {
      bean: 'shipping',
      kind: 'accept',
      body: 'I agree',
      references: [],
      idempotency_key: 'accept-1',
    };
    expect(BeanThreadPostInput.safeParse(accept).success).toBe(false);
    expect(
      BeanThreadPostInput.safeParse({
        ...accept,
        thread: 'thread-1',
        reply_to: 1,
        references: [{ bean: 'shipping', promise: 'delivery', revision: 1 }],
      }).success,
    ).toBe(true);
  });

  it('bounds contributor identity without depending on a harness slot', () => {
    expect(
      ContributorTokenClaims.safeParse({
        scope: 'contributor',
        run: 'abcdef',
        bean: 'shipping',
        actor: 'external-harness',
        expires_at: '2026-10-06T10:00:00Z',
      }).success,
    ).toBe(true);
    expect(BeanUpdateInput.safeParse({ ...update, changes: {} }).success).toBe(false);
    expect(
      BeanUpdateInput.safeParse({
        ...update,
        changes: {
          approach: {
            summary: 'Rewrite',
            paths: Array.from({ length: 65 }, () => 'src/file.ts'),
          },
        },
      }).success,
    ).toBe(false);
  });
});
