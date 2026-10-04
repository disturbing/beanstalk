import { test } from "node:test";
import assert from "node:assert/strict";
import { displayName } from "../src/users/index.ts";

test("displayName uses the name", () => {
  assert.equal(displayName({ id: "u1", name: "Ada", email: "ada@example.com" }), "Ada");
});
