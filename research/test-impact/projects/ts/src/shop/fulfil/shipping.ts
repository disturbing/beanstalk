import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as config from "../config.ts";
import { Money, zero } from "../core/money.ts";
import { DATA } from "../paths.ts";
import type { Cart } from "../sales/cart.ts";

export interface Zone {
  base_cents: number;
  per_kg_cents: number;
}

let cached: Record<string, Zone> | undefined;

export function zones(): Record<string, Zone> {
  cached ??= JSON.parse(readFileSync(join(DATA, "shipping_zones.json"), "utf8")) as Record<string, Zone>;
  return cached;
}

export function cost(cart: Cart, zone = "domestic"): Money {
  if (cart.count() === 0) return zero();
  if (zone === "domestic" && cart.subtotal().cents >= config.get<number>("free_shipping_over", 10 ** 9) * 100) {
    return zero();
  }
  const z = zones()[zone];
  if (!z) throw new Error(`no shipping zone ${zone}`);
  const kg = Math.ceil(cart.weightG() / 1000);
  return new Money(z.base_cents + z.per_kg_cents * kg);
}
