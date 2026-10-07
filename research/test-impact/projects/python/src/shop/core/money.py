from dataclasses import dataclass


@dataclass(frozen=True)
class Money:
    cents: int
    currency: str = "USD"

    def __add__(self, other: "Money") -> "Money":
        _same(self, other)
        return Money(self.cents + other.cents, self.currency)

    def __sub__(self, other: "Money") -> "Money":
        _same(self, other)
        return Money(self.cents - other.cents, self.currency)

    def times(self, qty: int) -> "Money":
        return Money(self.cents * qty, self.currency)

    def pct(self, rate: float) -> "Money":
        return Money(round_half_up(self.cents * rate), self.currency)

    def format(self) -> str:
        sign = "-" if self.cents < 0 else ""
        whole, frac = divmod(abs(self.cents), 100)
        return f"{sign}{whole}.{frac:02d} {self.currency}"


def round_half_up(x: float) -> int:
    return int(x + 0.5) if x >= 0 else -int(-x + 0.5)


def zero(currency: str = "USD") -> Money:
    return Money(0, currency)


def _same(a: Money, b: Money) -> None:
    if a.currency != b.currency:
        raise ValueError(f"currency mismatch {a.currency} != {b.currency}")
