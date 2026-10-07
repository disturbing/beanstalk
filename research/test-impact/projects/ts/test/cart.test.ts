import { test } from "node:test";
import assert from "node:assert/strict";
import { cartOf } from "./helpers/factories.ts";

test("subtotal", () => {
  const cart = cartOf({ SKU_001: 2, SKU_003: 1 });
  assert.equal(cart.subtotal().cents, 2850);
});

test("add merges lines", () => {
  const cart = cartOf({ SKU_001: 1 });
  cart.add("SKU-001", 2);
  assert.equal(cart.count(), 3);
  assert.equal(cart.lines.size, 1);
});

test("remove and weight", () => {
  const cart = cartOf({ SKU_002: 1, SKU_005: 2 });
  assert.equal(cart.weightG(), 1560);
  cart.remove("SKU-002");
  assert.equal(cart.weightG(), 360);
});
