import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { paginate } from './pagination.ts';

const items = Array.from({ length: 150 }, (_, i) => i);

describe('paginate', () => {
  it('returns the first page by default', () => {
    assert.equal(paginate(items, {}).length, 20);
    assert.equal(paginate(items, {})[0], 0);
  });

  it('honours limit and offset', () => {
    assert.deepEqual(paginate(items, { limit: '3', offset: '10' }), [10, 11, 12]);
  });

  it('clamps the limit and ignores garbage', () => {
    assert.equal(paginate(items, { limit: '1000' }).length, 100);
    assert.equal(paginate(items, { limit: 'abc', offset: '-4' }).length, 20);
  });
});
