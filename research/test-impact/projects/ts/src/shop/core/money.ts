export class Money {
  readonly cents: number;
  readonly currency: string;

  constructor(cents: number, currency = "USD") {
    this.cents = cents;
    this.currency = currency;
    Object.freeze(this);
  }

  add(other: Money): Money {
    same(this, other);
    return new Money(this.cents + other.cents, this.currency);
  }

  sub(other: Money): Money {
    same(this, other);
    return new Money(this.cents - other.cents, this.currency);
  }

  times(qty: number): Money {
    return new Money(this.cents * qty, this.currency);
  }

  pct(rate: number): Money {
    return new Money(roundHalfUp(this.cents * rate), this.currency);
  }

  equals(other: Money): boolean {
    return this.cents === other.cents && this.currency === other.currency;
  }

  format(): string {
    const sign = this.cents < 0 ? "-" : "";
    const abs = Math.abs(this.cents);
    const whole = Math.floor(abs / 100);
    const frac = abs % 100;
    return `${sign}${whole}.${String(frac).padStart(2, "0")} ${this.currency}`;
  }
}

export function roundHalfUp(x: number): number {
  return x >= 0 ? Math.trunc(x + 0.5) : -Math.trunc(-x + 0.5);
}

export function zero(currency = "USD"): Money {
  return new Money(0, currency);
}

function same(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new Error(`currency mismatch ${a.currency} != ${b.currency}`);
}
