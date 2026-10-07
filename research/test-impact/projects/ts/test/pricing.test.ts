import { test } from "node:test";
import assert from "node:assert/strict";
import { cartOf } from "./helpers/factories.ts";
import { quote } from "../src/shop/sales/pricing.ts";

test("plain quote", async () => {
  const q = await quote(cartOf({ SKU_001: 2 }));
  assert.equal(q.subtotal.cents, 2400);
  assert.equal(q.shipping.cents, 650);
  assert.equal(q.fees.cents, 48);
  assert.equal(q.tax.cents, 174);
  assert.equal(q.total.cents, 2400 + 650 + 48 + 174);
});

test("percent coupon", async () => {
  const q = await quote(cartOf({ SKU_002: 1 }), "PCT10");
  assert.equal(q.discount.cents, 350);
  assert.equal(q.tax.cents, 228);
});

test("freeship coupon", async () => {
  const q = await quote(cartOf({ SKU_004: 1 }), "FREESHIP", "domestic", "OR");
  assert.equal(q.shipping.cents, 0);
  assert.equal(q.tax.cents, 0);
});
