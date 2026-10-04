import { test } from "node:test";
import assert from "node:assert/strict";
import { itemCount, total } from "../src/cart/index.ts";

test("itemCount sums quantities", () => {
  assert.equal(itemCount([{ sku: "a", priceCents: 100, qty: 2 }, { sku: "b", priceCents: 5, qty: 3 }]), 5);
});

test("total multiplies price by quantity", () => {
  assert.equal(total([{ sku: "a", priceCents: 250, qty: 2 }]), 500);
});
