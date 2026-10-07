import { test } from "node:test";
import assert from "node:assert/strict";
import { padLeft, padRight, slugify } from "@shop/utils/strings";
import { isEmail, isSku } from "@shop/utils";

test("slugify", () => {
  assert.equal(slugify("Desk Lamp (Large)!"), "desk-lamp-large");
});

test("pads", () => {
  assert.equal(padRight("ab", 4), "ab  ");
  assert.equal(padLeft("ab", 4), "  ab");
  assert.equal(padRight("abcdef", 3), "abc");
});

test("validation", () => {
  assert.ok(isSku("SKU-123"));
  assert.ok(!isSku("SKU-12"));
  assert.ok(isEmail("a@b.io"));
  assert.ok(!isEmail("a@b"));
});
