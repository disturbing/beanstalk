import { test } from "node:test";
import assert from "node:assert/strict";
import { byCategory, catalog, find } from "../src/shop/catalog/products.ts";

test("catalog size", () => {
  assert.equal(catalog().size, 6);
});

test("find", () => {
  const p = find("SKU-002");
  assert.equal(p.name, "Tea Kettle");
  assert.equal(p.price.cents, 3500);
});

test("missing", () => {
  assert.throws(() => find("SKU-999"), /no product SKU-999/);
});

test("by category", () => {
  assert.deepEqual(byCategory("office").map((p) => p.sku), ["SKU-003", "SKU-004"]);
});
