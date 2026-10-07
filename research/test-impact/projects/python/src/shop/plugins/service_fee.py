from shop.core.money import Money

RATE = 0.02


def fee(base: Money) -> Money:
    return base.pct(RATE)
