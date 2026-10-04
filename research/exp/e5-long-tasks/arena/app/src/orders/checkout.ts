import { issueInvoice } from '../billing/service.ts';
import { clearCart, getCart, priceCart } from '../cart/service.ts';
import { reserve } from '../inventory/stock.ts';
import { badRequest } from '../lib/errors.ts';
import { enqueueNotification } from '../notifications/queue.ts';
import { quoteForOrder } from '../shipping/service.ts';
import type { AppContext, Order, OrderLine, ShippingMethod, User } from '../types.ts';

export interface CheckoutInput {
  /** Index into the user's saved addresses. */
  addressIndex: number;
  couponCode?: string;
  method?: ShippingMethod;
}

/** Turn the user's cart into a confirmed order: reserve stock, invoice it, quote shipping, notify. */
export function checkout(ctx: AppContext, user: User, input: CheckoutInput): Order {
  const address = user.addresses[input.addressIndex];
  if (!address) throw badRequest('choose a saved shipping address');
  const cart = getCart(ctx, user.id);
  const priced = priceCart(ctx, cart);

  reserve(ctx, cart.lines);

  const orderId = ctx.store.nextId('ord');
  const invoice = issueInvoice(ctx, {
    orderId,
    userId: user.id,
    address,
    couponCode: input.couponCode,
    items: priced.lines.map((line) => ({
      productId: line.productId,
      description: line.name,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      taxClass: line.product.taxClass,
    })),
  });

  const lines: OrderLine[] = priced.lines.map((line) => ({
    productId: line.productId,
    name: line.name,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
  }));
  const shipping = quoteForOrder(ctx, { lines, shippingAddress: address }, input.method ?? 'standard');
  const now = ctx.clock.now().toISOString();
  const order = ctx.store.orders.insert({
    id: orderId,
    number: `${ctx.config.orderNumberPrefix}-${orderId.slice(4)}`,
    userId: user.id,
    status: 'confirmed',
    lines,
    subtotal: invoice.subtotal,
    discount: invoice.discount,
    tax: invoice.tax,
    shippingCost: shipping.cost,
    total: invoice.total,
    couponCode: invoice.couponCode,
    shippingAddress: address,
    invoiceId: invoice.id,
    trackingNumber: null,
    createdAt: now,
    updatedAt: now,
  });

  clearCart(ctx, user.id);
  enqueueNotification(ctx, 'order_confirmed', order);
  return order;
}
