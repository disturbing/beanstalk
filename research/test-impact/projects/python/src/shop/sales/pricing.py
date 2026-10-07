from dataclasses import dataclass

from shop import plugins
from shop.core.money import Money, zero
from shop.fulfil import shipping
from shop.sales import discounts, tax
from shop.sales.cart import Cart
from shop.sales.coupons import parse


@dataclass(frozen=True)
class Quote:
    subtotal: Money
    discount: Money
    shipping: Money
    fees: Money
    tax: Money

    @property
    def total(self) -> Money:
        return self.subtotal - self.discount + self.shipping + self.fees + self.tax


def quote(cart: Cart, coupon: str | None = None, zone: str = "domestic", region: str | None = None) -> Quote:
    subtotal = cart.subtotal()
    discount = zero()
    ship = shipping.cost(cart, zone)
    if coupon:
        c = parse(coupon)
        if c.kind == "percent":
            discount = discounts.percent_off(cart, c.value)
        elif c.kind == "amount":
            discount = Money(min(c.value, subtotal.cents))
        elif c.kind == "shipping":
            ship = zero()
    fees = plugins.total_fees(subtotal - discount)
    taxed = tax.tax_on(subtotal - discount, region)
    return Quote(subtotal, discount, ship, fees, taxed)
