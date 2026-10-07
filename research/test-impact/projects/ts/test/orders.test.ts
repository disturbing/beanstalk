import { test } from "node:test";
import assert from "node:assert/strict";
import { cartOf, fixtureOrders, stocked as makeStocked } from "./helpers/factories.ts";
import { Bus } from "../src/shop/events.ts";
import { OrderService } from "../src/shop/fulfil/orders.ts";

test("place reserves and emits", async () => {
  const stocked = makeStocked();
  const bus = new Bus();
  const seen: string[] = [];
  bus.on("order.placed", (p) => seen.push(p));
  const svc = new OrderService(stocked, bus);
  const order = await svc.place(cartOf({ SKU_004: 2 }));
  assert.equal(order.id, "ORD00001");
  assert.equal(stocked.available("SKU-004"), 0);
  assert.deepEqual(seen, ["ORD00001"]);
});

test("cancel releases", async () => {
  const stocked = makeStocked();
  const svc = new OrderService(stocked);
  const order = await svc.place(cartOf({ SKU_006: 3 }));
  svc.cancel(order);
  assert.equal(order.state, "cancelled");
  assert.equal(stocked.available("SKU-006"), 3);
});

test("bad transition", async () => {
  const order = await new OrderService(makeStocked()).place(cartOf({ SKU_001: 1 }));
  assert.throws(() => order.move("shipped"), /cannot go new -> shipped/);
});

test("fixture orders", async () => {
  const svc = new OrderService(makeStocked());
  const ids: string[] = [];
  for (const o of fixtureOrders()) ids.push((await svc.place(cartOf(o.lines), o.coupon)).id);
  assert.deepEqual(ids, ["ORD00001", "ORD00002", "ORD00003", "ORD00004"]);
});
