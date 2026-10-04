import { badRequest } from '../lib/errors.ts';
import { sumCents } from '../lib/money.ts';
import type { AppContext, Cart, Cents, Product } from '../types.ts';

export interface PricedLine {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: Cents;
  lineTotal: Cents;
  product: Product;
}

export interface PricedCart {
  lines: PricedLine[];
  subtotal: Cents;
}

export function getCart(ctx: AppContext, userId: string): Cart {
  return (
    ctx.store.carts.get(userId) ?? { id: userId, lines: [], updatedAt: ctx.clock.now().toISOString() }
  );
}

function saveCart(ctx: AppContext, cart: Cart): Cart {
  const next = { ...cart, updatedAt: ctx.clock.now().toISOString() };
  if (ctx.store.carts.get(cart.id)) return ctx.store.carts.update(cart.id, next);
  return ctx.store.carts.insert(next);
}

export function addItem(ctx: AppContext, userId: string, productId: string, quantity: number): Cart {
  if (!Number.isInteger(quantity) || quantity < 1) throw badRequest('quantity must be at least 1');
  const product = ctx.store.products.require(productId);
  if (!product.active) throw badRequest(`${product.name} is not available`);
  const cart = getCart(ctx, userId);
  const existing = cart.lines.find((line) => line.productId === productId);
  if (existing) {
    existing.quantity += quantity;
  } else {
    if (cart.lines.length >= ctx.config.maxCartLines) throw badRequest('cart is full');
    cart.lines.push({ productId, quantity });
  }
  return saveCart(ctx, cart);
}

/** Set a line to an exact quantity. Zero removes the line. */
export function setQuantity(ctx: AppContext, userId: string, productId: string, quantity: number): Cart {
  if (!Number.isInteger(quantity) || quantity < 0) throw badRequest('quantity must be zero or more');
  const cart = getCart(ctx, userId);
  const line = cart.lines.find((l) => l.productId === productId);
  if (!line) throw badRequest('product is not in the cart');
  if (quantity === 0) cart.lines = cart.lines.filter((l) => l !== line);
  else line.quantity = quantity;
  return saveCart(ctx, cart);
}

export function removeItem(ctx: AppContext, userId: string, productId: string): Cart {
  const cart = getCart(ctx, userId);
  cart.lines = cart.lines.filter((line) => line.productId !== productId);
  return saveCart(ctx, cart);
}

export function clearCart(ctx: AppContext, userId: string): void {
  ctx.store.carts.delete(userId);
}

/** Attach current catalog prices to the cart's lines. */
export function priceCart(ctx: AppContext, cart: Cart): PricedCart {
  const lines = cart.lines.map((line) => {
    const product = ctx.store.products.require(line.productId);
    return {
      productId: product.id,
      name: product.name,
      quantity: line.quantity,
      unitPrice: product.price,
      lineTotal: product.price * line.quantity,
      product,
    };
  });
  return { lines, subtotal: sumCents(lines.map((l) => l.lineTotal)) };
}
