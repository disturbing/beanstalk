import { test } from "node:test";
import assert from "node:assert/strict";
import { convert, rates } from "../src/shop/core/currency.ts";
import { Money } from "../src/shop/core/money.ts";

test("rates loaded", () => {
  assert.equal(rates().EUR, 0.9);
  assert.equal(Object.keys(rates()).length, 5);
});

test("convert usd to jpy", () => {
  assert.deepEqual(convert(new Money(1000), "JPY"), new Money(150000, "JPY"));
});

test("convert round trip", () => {
  const eur = convert(new Money(1000), "EUR");
  assert.deepEqual(eur, new Money(900, "EUR"));
  assert.deepEqual(convert(eur, "USD"), new Money(1000));
});

test("unknown currency", () => {
  assert.throws(() => convert(new Money(1), "XXX"), /unknown currency/);
});
