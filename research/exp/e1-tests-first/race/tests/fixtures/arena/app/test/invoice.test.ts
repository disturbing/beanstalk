import { test } from "node:test";
import assert from "node:assert/strict";
import { invoiceLines } from "../src/invoice/index.ts";

test("invoiceLines prints one line per item", () => {
  assert.deepEqual(invoiceLines([{ sku: "mug", priceCents: 1200, qty: 2 }]), ["2 x mug @ $12.00"]);
});
