use std::collections::HashMap;

use shop_core::money::{zero_usd, Money};
use shop_fulfil::orders::{Order, OrderState};

/// Total of every order that is not cancelled.
pub fn revenue(orders: &[Order]) -> Money {
    orders
        .iter()
        .filter(|o| o.state != OrderState::Cancelled)
        .fold(zero_usd(), |total, o| total + o.quote.total())
}

/// Top `n` SKUs by units across all orders, ties broken by SKU.
pub fn top_skus(orders: &[Order], n: usize) -> Vec<(String, i64)> {
    let mut counts: HashMap<String, i64> = HashMap::new();
    for o in orders {
        for (sku, line) in &o.cart.lines {
            *counts.entry(sku.clone()).or_insert(0) += line.qty;
        }
    }
    let mut ranked: Vec<(String, i64)> = counts.into_iter().collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    ranked.truncate(n);
    ranked
}
