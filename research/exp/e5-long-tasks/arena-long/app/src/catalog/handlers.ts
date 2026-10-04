import { paginate } from '../lib/pagination.ts';
import { asBody, optionalString, requireInt, requireString } from '../lib/validate.ts';
import { created, ok } from '../router.ts';
import type { Handler } from '../router.ts';
import type { TaxClass } from '../types.ts';
import { createProduct, getProduct, listProducts, updateProduct } from './service.ts';

export const list: Handler = (req, ctx) => {
  const products = listProducts(ctx, { category: req.query.category, q: req.query.q });
  return ok(paginate(products, req.query, ctx.config.pageSize));
};

export const get: Handler = (req, ctx) => ok(getProduct(ctx, req.params.id));

export const create: Handler = (req, ctx) => {
  const body = asBody(req.body);
  const product = createProduct(ctx, {
    sku: requireString(body, 'sku'),
    name: requireString(body, 'name'),
    description: optionalString(body, 'description'),
    price: requireInt(body, 'price'),
    category: requireString(body, 'category'),
    taxClass: optionalString(body, 'taxClass') as TaxClass | undefined,
  });
  return created(product);
};

export const update: Handler = (req, ctx) => {
  const body = asBody(req.body);
  const patch: Parameters<typeof updateProduct>[2] = {};
  if (body.name !== undefined) patch.name = requireString(body, 'name');
  if (body.description !== undefined) patch.description = optionalString(body, 'description');
  if (body.price !== undefined) patch.price = requireInt(body, 'price');
  if (body.active !== undefined) patch.active = body.active === true;
  return ok(updateProduct(ctx, req.params.id, patch));
};
