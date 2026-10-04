import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp, placeOrder } from '../lib/testing.ts';
import type { NotificationKind } from '../types.ts';
import * as mod from './templates.ts';

const kinds: NotificationKind[] = ['order_confirmed', 'order_shipped', 'order_cancelled'];

type Render = (order: any, currency: any) => { subject: string; body: string };

function table(): Record<string, Render> {
  const templates = (mod as Record<string, unknown>).templates;
  assert.ok(templates && typeof templates === 'object', 'templates is exported');
  return templates as Record<string, Render>;
}

describe('notification templates table', () => {
  it('has a render function for every existing kind', () => {
    for (const kind of kinds) assert.equal(typeof table()[kind], 'function', kind);
  });

  it('renders the same text through the table as through renderNotification', () => {
    const app = createTestApp();
    const { order } = placeOrder(app, { price: 1500, quantity: 2 });
    const shipped = { ...order, trackingNumber: 'TRK123' };
    for (const kind of kinds) {
      assert.deepEqual(table()[kind](shipped, 'USD'), mod.renderNotification(kind, shipped, 'USD'), kind);
    }
  });

  it('keeps the existing text', () => {
    const app = createTestApp();
    const { order } = placeOrder(app, { price: 1500, quantity: 2 });
    const o = { ...order, trackingNumber: 'TRK123' };
    const t = table();
    assert.equal(t.order_shipped(o, 'USD').subject, `Order ${o.number} has shipped`);
    assert.equal(
      t.order_shipped(o, 'USD').body,
      `Your order ${o.number} is on its way.\nTracking number: TRK123`,
    );
    assert.equal(t.order_cancelled(o, 'USD').subject, `Order ${o.number} was cancelled`);
    assert.equal(
      t.order_cancelled(o, 'USD').body,
      `Your order ${o.number} was cancelled. Any payment will be refunded.`,
    );
    const confirmed = t.order_confirmed(o, 'USD');
    assert.equal(confirmed.subject, `Order ${o.number} confirmed`);
    assert.match(confirmed.body, /^Thanks for your order!\n2 x Product \d+ - \$30\.00\nTotal: \$/);
  });

  it('renderNotification looks the kind up in the table', () => {
    const app = createTestApp();
    const { order } = placeOrder(app);
    const t = table();
    const original = t.order_cancelled;
    try {
      t.order_cancelled = (o, currency) => ({ subject: `custom ${currency}`, body: `custom ${o.number}` });
      assert.deepEqual(mod.renderNotification('order_cancelled', order, 'USD'), {
        subject: 'custom USD',
        body: `custom ${order.number}`,
      });
    } finally {
      t.order_cancelled = original;
    }
  });
});
