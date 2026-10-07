import { test } from "node:test";
import assert from "node:assert/strict";
import { Sequence, shortId } from "../src/shop/core/ids.ts";
import { Bus } from "../src/shop/events.ts";
import { Repo } from "../src/shop/storage.ts";

test("sequence", () => {
  const s = new Sequence("X", 9);
  assert.deepEqual([s.take(), s.take()], ["X00009", "X00010"]);
});

test("short id stable", () => {
  assert.equal(shortId("c", "a", 1), shortId("c", "a", 1));
  assert.ok(shortId("c", "a", 1).startsWith("c-"));
});

test("bus and repo", () => {
  const bus = new Bus();
  const repo = new Repo<string>();
  bus.on("t", (p) => repo.put(p, p.toUpperCase()));
  bus.emit("t", "b");
  bus.emit("t", "a");
  assert.deepEqual(repo.all(), ["A", "B"]);
});
