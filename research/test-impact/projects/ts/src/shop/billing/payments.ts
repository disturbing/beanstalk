import type { Money } from "../core/money.ts";

export function luhnOk(number: string): boolean {
  const digits = [...number].filter((c) => c >= "0" && c <= "9").map(Number);
  if (digits.length < 12) return false;
  let total = 0;
  digits.reverse().forEach((d, i) => {
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    total += d;
  });
  return total % 10 === 0;
}

export function charge(card: string, amount: Money): string {
  if (amount.cents <= 0) return "rejected:amount";
  if (!luhnOk(card)) return "rejected:card";
  return "approved";
}
