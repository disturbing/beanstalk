import { enqueueNotification } from '../notifications/queue.ts';
import { badRequest, conflict } from '../lib/errors.ts';
import type { AppContext, Order, Shipment, ShippingMethod, ShippingQuote } from '../types.ts';
import { quoteShipping } from './rates.ts';

/** Weight of an order's lines, from current catalog data. */
export function orderWeight(ctx: AppContext, order: Pick<Order, 'lines'>): number {
  return order.lines.reduce((kg, line) => {
    const product = ctx.store.products.get(line.productId);
    return kg + (product?.weightKg ?? 0.5) * line.quantity;
  }, 0);
}

export function quoteForOrder(
  ctx: AppContext,
  order: Pick<Order, 'lines' | 'shippingAddress'>,
  method: ShippingMethod = 'standard',
): ShippingQuote {
  return quoteShipping(order.shippingAddress, orderWeight(ctx, order), method, ctx.config.defaultCountry);
}

export function getShipment(ctx: AppContext, orderId: string): Shipment | undefined {
  return ctx.store.shipments.findOne((s) => s.orderId === orderId);
}

/** Record the shipment for an order and mark the order as shipped. */
export function markShipped(ctx: AppContext, orderId: string, trackingNumber: string, method: ShippingMethod = 'standard'): Order {
  const order = ctx.store.orders.require(orderId);
  if (order.status !== 'confirmed') throw conflict(`order ${order.number} is ${order.status}, not confirmed`);
  if (!trackingNumber) throw badRequest('tracking number is required');
  const now = ctx.clock.now().toISOString();
  ctx.store.shipments.insert({
    id: ctx.store.nextId('shp'),
    orderId,
    method,
    cost: order.shippingCost,
    status: 'shipped',
    shippedAt: now,
  });
  const updated = ctx.store.orders.update(orderId, { status: 'shipped', trackingNumber, updatedAt: now });
  enqueueNotification(ctx, 'order_shipped', updated);
  return updated;
}
