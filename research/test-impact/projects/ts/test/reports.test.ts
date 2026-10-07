import { test } from "node:test";
import assert from "node:assert/strict";
import { cartOf, fixtureOrders, stocked as makeStocked } from "./helpers/factories.ts";
import { type Order, OrderService } from "../src/shop/fulfil/orders.ts";
import { revenue, topSkus } from "../src/shop/reports/sales.ts";

async function orders(): Promise<Order[]> {
  const svc = new OrderService(makeStocked());
  const out: Order[] = [];
  for (const o of fixtureOrders()) out.push(await svc.place(cartOf(o.lines), o.coupon));
  svc.cancel(out[1]);
  return out;
}

test("top skus", async () => {
  assert.deepEqual(topSkus(await orders()), [["SKU-003", 4], ["SKU-005", 3], ["SKU-001", 2]]);
});

test("revenue skips cancelled", async () => {
  assert.ok(revenue(await orders()).cents > 0);
});
