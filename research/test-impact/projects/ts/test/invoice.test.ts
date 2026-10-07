import { test } from "node:test";
import assert from "node:assert/strict";
import { cartOf } from "./helpers/factories.ts";
import { render } from "../src/shop/billing/invoice.ts";
import { Inventory } from "../src/shop/catalog/inventory.ts";
import { OrderService } from "../src/shop/fulfil/orders.ts";

test("invoice lines", async () => {
  const order = await new OrderService(new Inventory({ "SKU-003": 10 })).place(cartOf({ SKU_003: 2 }));
  const text = render(order).split("\n");
  assert.equal(text[0], "INVOICE ORD00001");
  assert.equal(text[1], "2 x Notebook            9.00 USD");
  assert.equal(text.at(-2), "Total                  16.33 USD");
  assert.equal(text.at(-1), "Thank you for shopping");
});
