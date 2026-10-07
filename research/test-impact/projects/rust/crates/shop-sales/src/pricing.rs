use shop_core::money::{zero_usd, Money};
use shop_core::Result;

use crate::cart::Cart;
use crate::coupons::{parse, CouponKind};
use crate::{discounts, plugins, shipping, tax};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Quote {
    pub subtotal: Money,
    pub discount: Money,
    pub shipping: Money,
    pub fees: Money,
    pub tax: Money,
}

impl Quote {
    pub fn total(&self) -> Money {
        self.subtotal.clone() - self.discount.clone() + self.shipping.clone() + self.fees.clone() + self.tax.clone()
    }
}

/// Domestic quote in the configured tax region.
pub fn quote(cart: &Cart, coupon: Option<&str>) -> Result<Quote> {
    quote_with(cart, coupon, "domestic", None)
}

pub fn quote_with(cart: &Cart, coupon: Option<&str>, zone: &str, region: Option<&str>) -> Result<Quote> {
    let subtotal = cart.subtotal();
    let mut discount = zero_usd();
    let mut ship = shipping::cost(cart, zone)?;
    if let Some(code) = coupon.filter(|c| !c.is_empty()) {
        let c = parse(code)?;
        match c.kind {
            CouponKind::Percent => discount = discounts::percent_off(cart, c.value),
            CouponKind::Amount => discount = Money::new(c.value.min(subtotal.cents)),
            CouponKind::Shipping => ship = zero_usd(),
        }
    }
    let base = subtotal.try_sub(&discount)?;
    let fees = plugins::total_fees(&base);
    let taxed = tax::tax_on(&base, region)?;
    Ok(Quote { subtotal, discount, shipping: ship, fees, tax: taxed })
}
