import { describe, expect, it } from 'vitest';

import { promptOutput } from './push-messages';

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
