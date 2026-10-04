import { asBody, requireInt } from '../lib/validate.ts';
import { ok } from '../router.ts';
import type { Handler } from '../router.ts';
import { availableQuantity, getStock, lowStock as findLowStock, setStock as updateStock } from './stock.ts';

export const get: Handler = (req, ctx) => {
  const level = getStock(ctx, req.params.productId);
  return ok({ ...level, available: availableQuantity(level) });
};

export const setStock: Handler = (req, ctx) => {
  const body = asBody(req.body);
  return ok(updateStock(ctx, req.params.productId, requireInt(body, 'onHand')));
};

export const lowStock: Handler = (_req, ctx) => ok(findLowStock(ctx));
