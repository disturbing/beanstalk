import { join } from "node:path";
import { DATA } from "../paths.ts";
import { readCsv } from "../util/csv.ts";
import { Money, roundHalfUp } from "./money.ts";

let cached: Record<string, number> | undefined;

export function rates(): Record<string, number> {
  if (!cached) {
    cached = {};
    for (const row of readCsv(join(DATA, "rates.csv"))) cached[row.code] = Number(row.per_usd);
  }
  return cached;
}

export function convert(m: Money, to: string): Money {
  const table = rates();
  if (!(m.currency in table) || !(to in table)) throw new Error(`unknown currency ${m.currency}->${to}`);
  const usd = m.cents / table[m.currency];
  return new Money(roundHalfUp(usd * table[to]), to);
}
