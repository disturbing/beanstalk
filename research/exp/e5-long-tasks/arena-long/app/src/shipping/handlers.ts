import { getCart, priceCart } from '../cart/service.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { asBody, optionalString, requireInt, requireString } from '../lib/validate.ts';
import { ok } from '../router.ts';
import type { Handler } from '../router.ts';
import type { ShippingMethod } from '../types.ts';
import { getShipment as findShipment, markShipped, quoteForOrder } from './service.ts';

function methodFrom(raw: string | undefined): ShippingMethod {
  if (raw === undefined) return 'standard';
  if (raw !== 'standard' && raw !== 'express') throw badRequest('method must be standard or express');
  return raw;
}

/** Quote shipping for the current cart to one of the user's saved addresses. */
export const quote: Handler = (req, ctx) => {
  const body = asBody(req.body);
  const address = req.user!.addresses[requireInt(body, 'addressIndex')];
  if (!address) throw badRequest('unknown address');
  const priced = priceCart(ctx, getCart(ctx, req.user!.id));
  const lines = priced.lines.map((l) => ({ productId: l.productId, name: l.name, quantity: l.quantity, unitPrice: l.unitPrice }));
  return ok(quoteForOrder(ctx, { lines, shippingAddress: address }, methodFrom(optionalString(body, 'method'))));
};

export const shipOrder: Handler = (req, ctx) => {
  const body = asBody(req.body);
  const order = markShipped(ctx, req.params.id, requireString(body, 'trackingNumber'), methodFrom(optionalString(body, 'method')));
  return ok(order);
};

export const getShipment: Handler = (req, ctx) => {
  const order = ctx.store.orders.require(req.params.id);
  if (order.userId !== req.user!.id && req.user!.role !== 'admin') throw notFound('order');
  const shipment = findShipment(ctx, order.id);
  if (!shipment) throw notFound('shipment');
  return ok({ ...shipment, trackingNumber: order.trackingNumber });
};
