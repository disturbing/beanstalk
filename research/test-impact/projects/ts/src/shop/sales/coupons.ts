export type CouponKind = "percent" | "amount" | "shipping";

export interface Coupon {
  readonly kind: CouponKind;
  readonly value: number;
}

export function coupon(kind: CouponKind, value: number): Coupon {
  return Object.freeze({ kind, value });
}

export function parse(raw: string): Coupon {
  const code = raw.trim().toUpperCase();
  if (code.startsWith("PCT")) return coupon("percent", toInt(code.slice(3)));
  if (code.startsWith("OFF")) return coupon("amount", toInt(code.slice(3)) * 100);
  if (code === "FREESHIP") return coupon("shipping", 0);
  throw new Error(`unknown coupon ${code}`);
}

function toInt(s: string): number {
  if (!/^[+-]?\d+$/.test(s)) throw new Error(`bad coupon value ${s}`);
  return Number.parseInt(s, 10);
}
