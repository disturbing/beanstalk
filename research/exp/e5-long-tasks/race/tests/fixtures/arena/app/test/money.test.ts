import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCents } from "../src/money/index.ts";

test("formatCents pads cents", () => {
  assert.equal(formatCents(1205), "$12.05");
  assert.equal(formatCents(-50), "-$0.50");
});
