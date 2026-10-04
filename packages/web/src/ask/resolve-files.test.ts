import { describe, expect, it } from 'vitest';

import { RunId, TaskId } from '@beanstalk/shared-race/ids';

import { recordedSource } from '../forge/recorded-source';
import { loadCorpus } from './corpus';
import type { ResolverCorpus } from './resolve-files';
import { MAX_RESOLVED_FILES, resolveFiles } from './resolve-files';

const v2 = RunId.parse('7z4j84eqvl');

async function resolveOnFixture(feature: string) {
  const corpus = await loadCorpus(recordedSource(), { run: v2, ref: 'sprout' }, feature);
  return resolveFiles(feature, corpus);
}

describe('resolving a feature to files on the recorded v2 run', () => {
  it('puts the coupon module first for "coupons", within the file-set limit', async () => {
    const ranked = await resolveOnFixture('coupons');
    expect(ranked[0]?.path).toBe('src/billing/coupons.ts');
    expect(ranked[0]?.reasons).toEqual(expect.arrayContaining(['path', 'content', 'bean']));
    expect(ranked.length).toBeLessThanOrEqual(MAX_RESOLVED_FILES);
    expect(
      ranked.every((file) => file.path.includes('coupon') || file.reasons.includes('content')),
    ).toBe(true);
  });

  it('ranks files that match every word of "tax rounding" above files matching one', async () => {
    const top = (await resolveOnFixture('tax rounding')).slice(0, 3).map((file) => file.path);
    expect(top).toEqual(
      expect.arrayContaining(['src/billing/tax-rounding.test.ts', 'src/billing/tax.ts']),
    );
  });

  it('finds code through bean intents when the code never says the words', async () => {
    const ranked = await resolveOnFixture('thousands separators');
    const money = ranked.find((file) => file.path === 'src/lib/money.ts');
    expect(money?.reasons).toContain('bean');
    expect(money?.beans).toEqual(['t005']);
  });

  it('returns nothing for a term the repo does not contain', async () => {
    expect(await resolveOnFixture('kubernetes')).toEqual([]);
  });
});

const beanId = (id: string) => TaskId.parse(id);

describe('resolver scoring', () => {
  const otherBeans = Array.from({ length: 8 }, (_, index) => ({
    id: beanId(`t1${String(index).padStart(2, '0')}`),
    title: `Unrelated change ${index}`,
    intent: '',
    files: ['CHANGELOG.md', `src/other/file-${index}.ts`],
  }));
  const corpus: ResolverCorpus = {
    paths: [
      'CHANGELOG.md',
      'src/payments/refund.ts',
      'src/payments/card.ts',
      'src/orders/order.ts',
    ],
    grep: new Map(),
    beans: [
      {
        id: beanId('t001'),
        title: 'Partial refunds',
        intent: '',
        files: ['CHANGELOG.md', 'src/payments/card.ts'],
      },
      {
        id: beanId('t003'),
        title: 'Gift cards',
        intent: '',
        files: ['CHANGELOG.md', 'src/payments/card.ts'],
      },
      ...otherBeans,
    ],
    tests: [],
  };

  it('scores a file every bean touches as no evidence (the changelog)', () => {
    const paths = resolveFiles('refunds', corpus).map((file) => file.path);
    expect(paths).toContain('src/payments/refund.ts');
    expect(paths).toContain('src/payments/card.ts');
    expect(paths).not.toContain('CHANGELOG.md');
  });

  it('ignores question words with no stem left', () => {
    expect(resolveFiles('a an', corpus)).toEqual([]);
  });
});
