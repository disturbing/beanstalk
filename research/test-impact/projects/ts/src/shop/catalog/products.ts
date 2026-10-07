import { join } from "node:path";
import { isSku, requireThat } from "@shop/utils/validation";
import { Money } from "../core/money.ts";
import { DATA } from "../paths.ts";
import { readCsv } from "../util/csv.ts";

export interface Product {
  readonly sku: string;
  readonly name: string;
  readonly price: Money;
  readonly weightG: number;
  readonly category: string;
}

let cached: Map<string, Product> | undefined;

export function catalog(): Map<string, Product> {
  if (!cached) {
    const out = new Map<string, Product>();
    for (const row of readCsv(join(DATA, "catalog.csv"))) {
      requireThat(isSku(row.sku), `bad sku ${row.sku}`);
      out.set(row.sku, Object.freeze({
        sku: row.sku,
        name: row.name,
        price: new Money(Number.parseInt(row.price_cents, 10)),
        weightG: Number.parseInt(row.weight_g, 10),
        category: row.category,
      }));
    }
    cached = out;
  }
  return cached;
}

export function find(sku: string): Product {
  const p = catalog().get(sku);
  if (!p) throw new Error(`no product ${sku}`);
  return p;
}

export function byCategory(category: string): Product[] {
  return [...catalog().values()]
    .filter((p) => p.category === category)
    .sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0));
}
