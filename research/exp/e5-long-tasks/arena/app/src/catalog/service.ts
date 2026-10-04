import { badRequest, conflict } from '../lib/errors.ts';
import type { AppContext, Cents, Product, TaxClass } from '../types.ts';
import { matchesQuery } from './search.ts';

export interface ProductInput {
  sku: string;
  name: string;
  description?: string;
  price: Cents;
  category: string;
  taxClass?: TaxClass;
  weightKg?: number;
}

export interface ProductFilter {
  category?: string;
  q?: string;
  includeInactive?: boolean;
}

export function createProduct(ctx: AppContext, input: ProductInput): Product {
  if (!Number.isInteger(input.price) || input.price < 0) throw badRequest('price must be a non-negative integer');
  if (ctx.store.products.findOne((p) => p.sku === input.sku)) throw conflict(`sku ${input.sku} is already in use`);
  return ctx.store.products.insert({
    id: ctx.store.nextId('prd'),
    sku: input.sku,
    name: input.name,
    description: input.description ?? '',
    price: input.price,
    category: input.category,
    taxClass: input.taxClass ?? 'standard',
    weightKg: input.weightKg ?? 0.5,
    active: true,
    createdAt: ctx.clock.now().toISOString(),
  });
}

export function getProduct(ctx: AppContext, id: string): Product {
  return ctx.store.products.require(id);
}

export function listProducts(ctx: AppContext, filter: ProductFilter = {}): Product[] {
  return ctx.store.products
    .find((p) => {
      if (!filter.includeInactive && !p.active) return false;
      if (filter.category && p.category !== filter.category) return false;
      if (filter.q && !matchesQuery(p, filter.q)) return false;
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type ProductPatch = Partial<
  Pick<Product, 'name' | 'description' | 'price' | 'category' | 'taxClass' | 'weightKg' | 'active'>
>;

export function updateProduct(ctx: AppContext, id: string, patch: ProductPatch): Product {
  if (patch.price !== undefined && (!Number.isInteger(patch.price) || patch.price < 0)) {
    throw badRequest('price must be a non-negative integer');
  }
  return ctx.store.products.update(id, patch);
}
