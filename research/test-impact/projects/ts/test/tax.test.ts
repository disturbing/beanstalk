import { test } from "node:test";
import assert from "node:assert/strict";
import { Money } from "../src/shop/core/money.ts";
import { rate, taxOn } from "../src/shop/sales/tax.ts";

test("default region from config", () => {
  assert.equal(rate(), 0.0725);
});

test("regions", () => {
  assert.equal(rate("OR"), 0.0);
  assert.deepEqual(taxOn(new Money(10000), "TX"), new Money(625));
});
