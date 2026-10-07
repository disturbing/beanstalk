import { test } from "node:test";
import assert from "node:assert/strict";
import { cartOf } from "./helpers/factories.ts";
import { cost } from "../src/shop/fulfil/shipping.ts";
import { Cart } from "../src/shop/sales/cart.ts";

test("empty cart ships free", () => {
  assert.equal(cost(new Cart()).cents, 0);
});

test("domestic by weight", () => {
  assert.equal(cost(cartOf({ SKU_002: 1 })).cents, 500 + 150 * 2);
});

test("free over threshold", () => {
  assert.equal(cost(cartOf({ SKU_006: 3 })).cents, 0);
});

test("intl", () => {
  assert.equal(cost(cartOf({ SKU_001: 1 }), "intl").cents, 1500 + 600);
});
