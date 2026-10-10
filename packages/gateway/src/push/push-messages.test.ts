import { describe, expect, it } from 'vitest';

import { promptOutput, withoutRemotePrefix } from './push-messages';

describe('verdict output', () => {
  it('keeps the telling lines of the suite output and drops stack frames', () => {
    const prompt = [
      'Output:',
      '```',
      'not ok 1 - a 10% discount on 100 is 90',
      '    at TestContext.<anonymous> (/work/test/discount.test.js:4:50)',
      '  {',
      "  code: 'ERR_ASSERTION',",
      '  actual: 99,',
      '  }',
      '```',
    ].join('\n');
    expect(promptOutput(prompt)).toEqual([
      'not ok 1 - a 10% discount on 100 is 90',
      "  code: 'ERR_ASSERTION',",
      '  actual: 99,',
    ]);
  });
});

describe('stored remote lines', () => {
  it('drops the prefix, also the one verdicts stored before the rename carry', () => {
    expect(withoutRemotePrefix('gitstalk: LANDED: a')).toBe('LANDED: a');
    expect(withoutRemotePrefix('beanstalk: LANDED: a')).toBe('LANDED: a');
    expect(withoutRemotePrefix('gitstalk:   indented')).toBe('  indented');
    expect(withoutRemotePrefix('plain')).toBe('plain');
  });
});
