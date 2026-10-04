import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp, placeOrder } from '../lib/testing.ts';
import type { Notification } from '../types.ts';
import { enqueueNotification, flushNotifications } from './queue.ts';
import { renderNotification } from './templates.ts';

describe('notifications', () => {
  it('lists every line item and the total in the confirmation', () => {
    const app = createTestApp();
    const { order } = placeOrder(app, { price: 1500, quantity: 2 });
    const { subject, body } = renderNotification('order_confirmed', order, 'USD');
    assert.equal(subject, `Order ${order.number} confirmed`);
    assert.match(body, /2 x Product \d+ - \$30\.00/);
    assert.match(body, /Total: \$/);
  });

  it('keeps notifications queued while the mailer is down and retries on flush', () => {
    const app = createTestApp();
    let down = true;
    app.ctx.mailer = {
      send(message) {
        if (down) throw new Error('smtp unavailable');
        app.mailer.send(message);
      },
    };
    const { order } = placeOrder(app);
    assert.equal(app.ctx.store.notifications.all()[0].status, 'queued');
    down = false;
    assert.equal(flushNotifications(app.ctx), 1);
    assert.equal(enqueueNotification(app.ctx, 'order_shipped', order).status, 'sent');
    assert.equal(app.mailer.sent.length, 2);
  });

  it('shows a customer their own notifications, newest first', () => {
    const app = createTestApp();
    const { order, token } = placeOrder(app);
    app.clock.advance(1000);
    enqueueNotification(app.ctx, 'order_shipped', order);
    placeOrder(app, { email: 'other@example.com' });
    const list = app.call('GET', '/notifications', { token }).body as Notification[];
    assert.deepEqual(list.map((n) => n.kind), ['order_shipped', 'order_confirmed']);
  });
});
