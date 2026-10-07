import { test } from "node:test";
import assert from "node:assert/strict";
import { cartOf } from "./helpers/factories.ts";
import * as discounts from "../src/shop/sales/discounts.ts";
import { coupon, parse } from "../src/shop/sales/coupons.ts";

test("percent off capped", () => {
  const cart = cartOf({ SKU_002: 2 });
  assert.equal(discounts.percentOff(cart, 10).cents, 700);
  assert.equal(discounts.percentOff(cart, 80).cents, 3500);
});

test("threshold", () => {
  const cart = cartOf({ SKU_004: 1 });
  assert.equal(discounts.thresholdOff(cart, 4000, 500).cents, 500);
  assert.equal(discounts.thresholdOff(cart, 5000, 500).cents, 0);
});

test("bogo", () => {
  const cart = cartOf({ SKU_005: 5 });
  assert.equal(discounts.bogo(cart, "SKU-005").cents, 3600);
});

test("coupon parse", () => {
  assert.deepEqual(parse(" pct15 "), coupon("percent", 15));
  assert.deepEqual(parse("OFF7"), coupon("amount", 700));
  assert.deepEqual(parse("freeship"), coupon("shipping", 0));
});
