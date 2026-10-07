import type { Inventory } from "../catalog/inventory.ts";
import { Sequence } from "../core/ids.ts";
import { Bus } from "../events.ts";
import type { Cart } from "../sales/cart.ts";
import { type Quote, quote } from "../sales/pricing.ts";

export const TRANSITIONS: Record<string, ReadonlySet<string>> = {
  new: new Set(["paid", "cancelled"]),
  paid: new Set(["shipped", "refunded"]),
  shipped: new Set(["delivered"]),
};

export class Order {
  id: string;
  cart: Cart;
  quote: Quote;
  state = "new";
  history: string[] = [];

  constructor(id: string, cart: Cart, q: Quote) {
    this.id = id;
    this.cart = cart;
    this.quote = q;
  }

  move(to: string): void {
    if (!TRANSITIONS[this.state]?.has(to)) throw new Error(`cannot go ${this.state} -> ${to}`);
    this.history.push(this.state);
    this.state = to;
  }
}

export class OrderService {
  inventory: Inventory;
  bus: Bus;
  seq = new Sequence("ORD");

  constructor(inventory: Inventory, bus?: Bus | null) {
    this.inventory = inventory;
    this.bus = bus ?? new Bus();
  }

  async place(cart: Cart, coupon: string | null = null): Promise<Order> {
    for (const [sku, line] of cart.lines) this.inventory.reserve(sku, line.qty);
    const order = new Order(this.seq.take(), cart, await quote(cart, coupon));
    this.bus.emit("order.placed", order.id);
    return order;
  }

  cancel(order: Order): void {
    order.move("cancelled");
    for (const [sku, line] of order.cart.lines) this.inventory.release(sku, line.qty);
    this.bus.emit("order.cancelled", order.id);
  }
}
