import { asBody, requireInt, requireString } from '../lib/validate.ts';
import { created, ok } from '../router.ts';
import type { Handler } from '../router.ts';
import { addItem as addToCart, getCart, priceCart, removeItem as removeFromCart, setQuantity as setLineQuantity } from './service.ts';

function view(ctx: Parameters<Handler>[1], userId: string) {
  const cart = getCart(ctx, userId);
  const priced = priceCart(ctx, cart);
  return {
    lines: priced.lines.map(({ product: _product, ...line }) => line),
    subtotal: priced.subtotal,
    updatedAt: cart.updatedAt,
  };
}

export const show: Handler = (req, ctx) => ok(view(ctx, req.user!.id));

export const addItem: Handler = (req, ctx) => {
  const body = asBody(req.body);
  addToCart(ctx, req.user!.id, requireString(body, 'productId'), requireInt(body, 'quantity', 1));
  return created(view(ctx, req.user!.id));
};

export const setQuantity: Handler = (req, ctx) => {
  const body = asBody(req.body);
  setLineQuantity(ctx, req.user!.id, req.params.productId, requireInt(body, 'quantity'));
  return ok(view(ctx, req.user!.id));
};

export const removeItem: Handler = (req, ctx) => {
  removeFromCart(ctx, req.user!.id, req.params.productId);
  return ok(view(ctx, req.user!.id));
};
