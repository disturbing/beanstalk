/** Fee plugins, loaded by name from config (a dynamic import). */
import * as config from "../shop/config.ts";
import { type Money, zero } from "../shop/core/money.ts";

export interface FeePlugin {
  fee(base: Money): Money;
}

export async function load(name: string): Promise<FeePlugin> {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`bad plugin name ${name}`);
  return (await import(`./${name}.ts`)) as FeePlugin;
}

export async function totalFees(base: Money): Promise<Money> {
  let total = zero();
  for (const name of config.get<string[]>("fee_plugins", [])) total = total.add((await load(name)).fee(base));
  return total;
}
