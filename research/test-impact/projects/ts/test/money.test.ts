import { test } from "node:test";
import assert from "node:assert/strict";
import { Money, roundHalfUp, zero } from "../src/shop/core/money.ts";

test("add and sub", () => {
  assert.deepEqual(new Money(150).add(new Money(250)), new Money(400));
  assert.deepEqual(new Money(500).sub(new Money(120)), new Money(380));
});

test("currency mismatch", () => {
  assert.throws(() => new Money(1, "USD").add(new Money(1, "EUR")), /currency mismatch/);
});

test("pct rounds half up", () => {
  assert.deepEqual(new Money(1000).pct(0.0725), new Money(73));
  assert.equal(roundHalfUp(2.5), 3);
  assert.equal(roundHalfUp(-2.5), -3);
});

test("format", () => {
  assert.equal(new Money(123456).format(), "1234.56 USD");
  assert.equal(new Money(-5).format(), "-0.05 USD");
  assert.equal(zero("EUR").format(), "0.00 EUR");
});
