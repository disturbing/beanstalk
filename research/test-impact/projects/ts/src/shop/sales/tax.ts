import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as config from "../config.ts";
import type { Money } from "../core/money.ts";
import { DATA } from "../paths.ts";

let cached: Record<string, number> | undefined;

export function table(): Record<string, number> {
  cached ??= JSON.parse(readFileSync(join(DATA, "tax.json"), "utf8")) as Record<string, number>;
  return cached;
}

export function rate(region?: string | null): number {
  const r = region || config.get<string>("tax_region");
  const t = table();
  if (!(r in t)) throw new Error(`no tax region ${r}`);
  return t[r];
}

export function taxOn(amount: Money, region?: string | null): Money {
  return amount.pct(rate(region));
}
