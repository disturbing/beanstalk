import { voidInvoice } from '../billing/service.ts';
import { release } from '../inventory/stock.ts';
import { conflict, notFound } from '../lib/errors.ts';
import { enqueueNotification } from '../notifications/queue.ts';
import type { AppContext, Order, OrderStatus, User } from '../types.ts';

const CANCELLABLE: OrderStatus[] = ['pending', 'confirmed'];

export function getOrder(ctx: AppContext, id: string): Order {
  return ctx.store.orders.require(id);
}

/** An order the user is allowed to see: their own, or any for an admin. */
export function getVisibleOrder(ctx: AppContext, user: User, id: string): Order {
  const order = getOrder(ctx, id);
  if (order.userId !== user.id && user.role !== 'admin') throw notFound('order');
  return order;
}

/** A user's orders, newest first. */
export function listOrders(ctx: AppContext, userId: string): Order[] {
  return ctx.store.orders
    .find((order) => order.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

export function cancelOrder(ctx: AppContext, user: User, id: string): Order {
  const order = getVisibleOrder(ctx, user, id);
  if (!CANCELLABLE.includes(order.status)) {
    throw conflict(`order ${order.number} is ${order.status} and can no longer be cancelled`);
  }
  release(ctx, order.lines);
  if (order.invoiceId) voidInvoice(ctx, order.invoiceId);
  const cancelled = ctx.store.orders.update(id, {
    status: 'cancelled',
    updatedAt: ctx.clock.now().toISOString(),
  });
  enqueueNotification(ctx, 'order_cancelled', cancelled);
  return cancelled;
}
