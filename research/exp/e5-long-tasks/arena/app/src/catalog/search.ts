import type { Product } from '../types.ts';

/** Lower-cased words of a search string. */
export function tokenize(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter(Boolean);
}

/** A product matches when every query word appears in its name, description or SKU. */
export function matchesQuery(product: Product, query: string): boolean {
  const haystack = `${product.name} ${product.description} ${product.sku}`.toLowerCase();
  return tokenize(query).every((word) => haystack.includes(word));
}
