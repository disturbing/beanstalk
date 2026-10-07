use shop_core::money::{zero_usd, Money};

use crate::cart::Cart;

/// Percent off the subtotal, capped by `max_discount_pct` from config.
pub fn percent_off(cart: &Cart, pct: i64) -> Money {
    let cap = shop_config::get_int("max_discount_pct", 100);
    cart.subtotal().pct(pct.min(cap) as f64 / 100.0)
}

pub fn threshold_off(cart: &Cart, over_cents: i64, off_cents: i64) -> Money {
    if cart.subtotal().cents >= over_cents {
        Money::new(off_cents)
    } else {
        zero_usd()
    }
}

/// Buy one, get one: every second unit of `sku` is free.
pub fn bogo(cart: &Cart, sku: &str) -> Money {
    match cart.lines.get(sku) {
        Some(line) => line.product.price.times(line.qty / 2),
        None => zero_usd(),
    }
}
