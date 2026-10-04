import { describe, expect, it } from 'vitest';

import { classifyByKeywords, keywordClassifier, validSpec } from './classifier';
import { parseQuestion, stem } from './question-words';
import { CATALOG, QUESTION_CLASSES } from './view-spec';

describe('the keyword router', () => {
  it.each(QUESTION_CLASSES)('routes the catalog example of %s to its class', (cls) => {
    expect(classifyByKeywords(CATALOG[cls].example, 'sprout').class).toBe(cls);
  });

  it.each([
    ['what changed recently on coupons?', 'recent-changes', 'coupons'],
    ['who changed tax rounding and why?', 'who-why', 'tax rounding'],
    ["what's being worked on in billing right now?", 'in-flight', 'billing'],
    ['why did the sprout go red at 3pm?', 'what-broke', null],
    ['what did we decide about money formatting?', 'decisions', 'money formatting'],
    ['what tests cover checkout?', 'tests-for', 'checkout'],
    ['invoice', 'explore', 'invoice'],
  ] as const)('reads "%s" as %s about %s', (question, cls, feature) => {
    const spec = classifyByKeywords(question, 'sprout');
    expect(spec.class).toBe(cls);
    expect(spec.entities.feature).toBe(feature);
  });

  it('prefers what broke over why when the question names a red line', () => {
    expect(classifyByKeywords('why is the stalk failing?', 'sprout').class).toBe('what-broke');
  });

  it('keeps the asked line, and the default otherwise', () => {
    expect(classifyByKeywords('what changed on the stalk?', 'sprout').range.ref).toBe('stalk');
    expect(classifyByKeywords('what changed?', 'stalk').range.ref).toBe('stalk');
    expect(classifyByKeywords("what's on sprout but not on stalk?", 'stalk').range.ref).toBe(
      'sprout',
    );
  });

  it('answers through the Classifier interface and says who answered', async () => {
    const answer = await keywordClassifier.classify('show bean t032', 'sprout');
    expect(answer.by).toBe('keywords');
    expect(answer.spec.entities.bean).toBe('t032');
  });

  it('accepts only specs that fit the catalog', () => {
    const spec = classifyByKeywords('what changed?', 'sprout');
    expect(validSpec(spec)).toEqual(spec);
    expect(validSpec({ ...spec, class: 'generate-a-layout' })).toBeUndefined();
    expect(validSpec({ ...spec, extra: true })).toBeUndefined();
  });
});

describe('question entities', () => {
  it('reads beans, agents, paths and time ranges', () => {
    expect(parseQuestion('what has agent 3 done in the last 10 minutes?')).toMatchObject({
      agent: 'a3',
      minutes: 10,
    });
    expect(parseQuestion('what did a11 change in src/billing/tax.ts today?')).toMatchObject({
      agent: 'a11',
      paths: ['src/billing/tax.ts'],
      minutes: 24 * 60,
    });
    expect(parseQuestion('why was T032 declined?').bean).toBe('t032');
    expect(parseQuestion('what landed in the past 2 hours').minutes).toBe(120);
    expect(parseQuestion('what landed recently').minutes).toBeNull();
  });

  it('keeps the subject words and drops the question words', () => {
    expect(parseQuestion('What changed recently on the coupons?').feature).toBe('coupons');
    expect(parseQuestion('what is going on?').feature).toBeNull();
  });

  it('stems plurals, gerunds and past tenses for matching code', () => {
    expect(
      ['coupons', 'rounding', 'formatting', 'taxes', 'billing', 'categories'].map(stem),
    ).toEqual(['coupon', 'round', 'format', 'tax', 'bill', 'category']);
  });
});
