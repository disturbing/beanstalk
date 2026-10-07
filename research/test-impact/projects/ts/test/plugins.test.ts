import { test } from "node:test";
import assert from "node:assert/strict";
import * as plugins from "../src/plugins/index.ts";
import { Money } from "../src/shop/core/money.ts";

test("configured fees", async () => {
  assert.equal((await plugins.totalFees(new Money(10000))).cents, 200);
});

test("load by name", async () => {
  assert.equal((await plugins.load("service_fee")).fee(new Money(500)).cents, 10);
});
