import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Inventory } from "../../src/shop/catalog/inventory.ts";
import { Cart } from "../../src/shop/sales/cart.ts";

export const FIXTURES = fileURLToPath(new URL("../fixtures/", import.meta.url));

export interface FixtureOrder {
  lines: Record<string, number>;
  coupon: string | null;
}

/** cartOf({ SKU_001: 2 }) — underscores become dashes, like the Python kwargs helper. */
export function cartOf(qty: Record<string, number>): Cart {
  const cart = new Cart();
  for (const [sku, n] of Object.entries(qty)) cart.add(sku.replaceAll("_", "-"), n);
  return cart;
}

export function fixtureOrders(): FixtureOrder[] {
  return JSON.parse(readFileSync(`${FIXTURES}orders.json`, "utf8")) as FixtureOrder[];
}

/** The `stocked` fixture from conftest.py. */
export function stocked(): Inventory {
  return new Inventory({ "SKU-001": 10, "SKU-002": 5, "SKU-003": 100, "SKU-004": 2, "SKU-005": 20, "SKU-006": 3 });
}
