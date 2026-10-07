import { test } from "node:test";
import assert from "node:assert/strict";
import { charge, luhnOk } from "../src/shop/billing/payments.ts";
import { Money } from "../src/shop/core/money.ts";

test("luhn", () => {
  assert.ok(luhnOk("4539 1488 0343 6467"));
  assert.ok(!luhnOk("4539 1488 0343 6468"));
  assert.ok(!luhnOk("1234"));
});

test("charge", () => {
  assert.equal(charge("4539148803436467", new Money(100)), "approved");
  assert.equal(charge("4539148803436468", new Money(100)), "rejected:card");
  assert.equal(charge("4539148803436467", new Money(0)), "rejected:amount");
});
