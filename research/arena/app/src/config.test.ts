import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultConfig, loadConfig } from './config.ts';

describe('config', () => {
  it('uses defaults when nothing is overridden', () => {
    assert.deepEqual(loadConfig({}), defaultConfig);
  });

  it('reads overrides and rejects bad values', () => {
    const config = loadConfig({ SHOP_CURRENCY: 'CAD', SESSION_TTL_SECONDS: '60', LOW_STOCK_THRESHOLD: '2' });
    assert.equal(config.currency, 'CAD');
    assert.equal(config.sessionTtlSeconds, 60);
    assert.equal(config.lowStockThreshold, 2);
    assert.throws(() => loadConfig({ SHOP_CURRENCY: 'XYZ' }), /unsupported currency/);
    assert.throws(() => loadConfig({ MAX_CART_LINES: 'many' }), /invalid integer/);
  });
});
