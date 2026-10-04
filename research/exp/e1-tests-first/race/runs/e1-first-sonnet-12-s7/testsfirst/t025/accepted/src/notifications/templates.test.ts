import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp, placeOrder } from '../lib/testing.ts';
import { renderNotification, templates } from './templates.ts';
import type { NotificationKind } from '../types.ts';

const kinds: NotificationKind[] = ['order_confirmed', 'order_shipped', 'order_cancelled'];

describe('notification templates table', () => {
  it('has a render function for every existing kind', () => {
    assert.ok(templates && typeof templates === 'object');
    for (const kind of kinds) assert.equal(typeof templates[kind], 'function', kind);
  });

  it('renders the same text through the table and renderNotification', () => {
    const app = createTestApp();
    const { order } = placeOrder(app, { price: 1500, quantity: 2 });
    const shipped = { ...order, trackingNumber: 'TRK-9' };
    for (const o of [order, shipped]) {
      for (const kind of kinds) {
        assert.deepEqual(templates[kind](o, 'USD'), renderNotification(kind, o, 'USD'), kind);
      }
    }
  });

  it('keeps the existing text', () => {
    const app = createTestApp();
    const { order } = placeOrder(app, { price: 1500, quantity: 2 });
    const line = order.lines[0];
    assert.deepEqual(templates.order_confirmed(order, 'USD'), {
      subject: `Order ${order.number} confirmed`,
      body: `Thanks for your order!\n2 x ${line.name} - $30.00\nTotal: $${(order.total / 100).toFixed(2)}`,
    });
    assert.deepEqual(templates.order_cancelled(order, 'USD'), {
      subject: `Order ${order.number} was cancelled`,
      body: `Your order ${order.number} was cancelled. Any payment will be refunded.`,
    });
    assert.deepEqual(templates.order_shipped({ ...order, trackingNumber: 'T-1' }, 'USD'), {
      subject: `Order ${order.number} has shipped`,
      body: `Your order ${order.number} is on its way.\nTracking number: T-1`,
    });
  });

  it('renderNotification looks the kind up in the table', () => {
    const app = createTestApp();
    const { order } = placeOrder(app);
    const original = templates.order_cancelled;
    templates.order_cancelled = () => ({ subject: 'custom subject', body: 'custom body' });
    try {
      assert.deepEqual(renderNotification('order_cancelled', order, 'USD'), {
        subject: 'custom subject',
        body: 'custom body',
      });
    } finally {
      templates.order_cancelled = original;
    }
  });
});
