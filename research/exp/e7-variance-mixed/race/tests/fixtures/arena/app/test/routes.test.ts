import { test } from "node:test";
import assert from "node:assert/strict";
import { findRoute } from "../src/routes/index.ts";

test("cart route exists", () => {
  assert.ok(findRoute("GET", "/cart"));
  assert.equal(findRoute("GET", "/nope"), undefined);
});
