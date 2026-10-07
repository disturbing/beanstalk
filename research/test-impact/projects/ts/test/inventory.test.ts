import { test } from "node:test";
import assert from "node:assert/strict";
import { OutOfStock } from "../src/shop/catalog/inventory.ts";
import { stocked as makeStocked } from "./helpers/factories.ts";

test("reserve and release", () => {
  const stocked = makeStocked();
  stocked.reserve("SKU-004", 2);
  assert.equal(stocked.available("SKU-004"), 0);
  stocked.release("SKU-004", 1);
  assert.equal(stocked.available("SKU-004"), 1);
});

test("out of stock", () => {
  const stocked = makeStocked();
  assert.throws(() => stocked.reserve("SKU-006", 4), OutOfStock);
});

test("commit", () => {
  const stocked = makeStocked();
  stocked.reserve("SKU-001", 3);
  stocked.commit("SKU-001", 3);
  assert.equal(stocked.levels["SKU-001"], 7);
  assert.equal(stocked.available("SKU-001"), 7);
});

test("bad qty", () => {
  const stocked = makeStocked();
  assert.throws(() => stocked.reserve("SKU-001", 0), RangeError);
});
