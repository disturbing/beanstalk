// Shared helpers for tests. Not imported by production code.
import { createApp } from '../app.ts';
import type { App } from '../app.ts';
import { loadConfig } from '../config.ts';
import { createSession } from '../auth/sessions.ts';
import { setStock } from '../inventory/stock.ts';
import { createProduct } from '../catalog/service.ts';
import { createMemoryMailer } from '../notifications/queue.ts';
import { registerUser } from '../users/service.ts';
import { fakeClock } from './clock.ts';
import type { Address, AppContext, Coupon, Order, Product, TaxClass, User } from '../types.ts';
import type { ProductInput } from '../catalog/service.ts';
import type { Response } from '../router.ts';

export const CA_ADDRESS: Address = {
  line1: '12 Rue Saint-Denis',
  city: 'Montreal',
  region: 'QC',
  postalCode: 'H2X 1K4',
  country: 'CA',
};

export const US_ADDRESS: Address = {
  line1: '500 Pine St',
  city: 'Seattle',
  region: 'WA',
  postalCode: '98101',
  country: 'US',
};

export const ON_ADDRESS: Address = { ...CA_ADDRESS, city: 'Toronto', region: 'ON', postalCode: 'M5V 2T6' };

export interface TestApp extends App {
  clock: ReturnType<typeof fakeClock>;
  mailer: ReturnType<typeof createMemoryMailer>;
  call(
    method: string,
    path: string,
    options?: { body?: unknown; token?: string; query?: Record<string, string> },
  ): Response;
}

export function createTestApp(): TestApp {
  const clock = fakeClock();
  const mailer = createMemoryMailer();
  const config = loadConfig({ PASSWORD_COST: '16' });
  const app = createApp({ clock, mailer, config });
  return {
    ...app,
    clock,
    mailer,
    call(method, path, options = {}) {
      return app.handle({
        method,
        path,
        body: options.body,
        query: options.query,
        headers: options.token ? { authorization: `Bearer ${options.token}` } : {},
      });
    },
  };
}

/** Register a user and open a session for them. Pass `admin: true` for an admin. */
export function signUp(
  ctx: AppContext,
  email = 'ada@example.com',
  options: { admin?: boolean; address?: Address | null } = {},
): { user: User; token: string } {
  let user = registerUser(ctx, { email, name: 'Test User', password: 'correct horse' });
  const address = options.address === undefined ? CA_ADDRESS : options.address;
  const patch: Partial<User> = {};
  if (address) patch.addresses = [address];
  if (options.admin) patch.role = 'admin';
  if (Object.keys(patch).length > 0) user = ctx.store.users.update(user.id, patch);
  return { user, token: createSession(ctx, user.id).id };
}

/** The `error.message` of an error response. */
export function errorMessage(res: Response): string {
  return (res.body as { error: { message: string } }).error.message;
}

let skuCounter = 0;

/** A product with `stock` units on hand. Defaults to a $20.00 standard-rated item. */
export function addProduct(
  ctx: AppContext,
  overrides: Partial<ProductInput> & { stock?: number } = {},
): Product {
  const { stock = 100, ...input } = overrides;
  skuCounter += 1;
  const product = createProduct(ctx, {
    sku: `SKU-${skuCounter}`,
    name: `Product ${skuCounter}`,
    price: 2000,
    category: 'general',
    ...input,
  });
  setStock(ctx, product.id, stock);
  return product;
}

export interface Checkout {
  user: User;
  token: string;
  product: Product;
  res: Response;
}

interface CheckoutOptions {
  email?: string;
  address?: Address;
  price?: number;
  quantity?: number;
  couponCode?: string;
  taxClass?: TaxClass;
  stock?: number;
}

/** Sign up a customer, put `quantity` of a new product in their cart and check out. Returns the raw response. */
export function tryCheckout(app: TestApp, options: CheckoutOptions = {}): Checkout {
  const { user, token } = signUp(app.ctx, options.email ?? 'buyer@example.com', {
    address: options.address ?? CA_ADDRESS,
  });
  const product = addProduct(app.ctx, {
    price: options.price ?? 2000,
    taxClass: options.taxClass,
    stock: options.stock,
  });
  app.call('POST', '/cart/items', { token, body: { productId: product.id, quantity: options.quantity ?? 1 } });
  const res = app.call('POST', '/checkout', { token, body: { addressIndex: 0, couponCode: options.couponCode } });
  return { user, token, product, res };
}

export interface PlacedOrder extends Omit<Checkout, 'res'> {
  order: Order;
}

/** Like `tryCheckout`, but throws unless the order was created. */
export function placeOrder(app: TestApp, options: CheckoutOptions = {}): PlacedOrder {
  const { res, ...rest } = tryCheckout(app, options);
  if (res.status !== 201) throw new Error(`checkout failed: ${JSON.stringify(res.body)}`);
  return { ...rest, order: res.body as Order };
}

/** Insert a coupon straight into the store. Defaults to an unlimited 10% coupon. */
export function addCoupon(ctx: AppContext, overrides: Partial<Coupon> & { id: string }): Coupon {
  return ctx.store.coupons.insert({
    kind: 'percent',
    value: 10,
    minSubtotal: 0,
    expiresAt: null,
    maxRedemptions: null,
    redemptions: 0,
    ...overrides,
  });
}
