//! Shipping cost by zone, from `data/shipping_zones.txt` (read once at runtime).

use std::collections::HashMap;
use std::sync::OnceLock;

use shop_core::money::{zero_usd, Money};
use shop_core::{paths, Result, ShopError};

use crate::cart::Cart;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Zone {
    pub base_cents: i64,
    pub per_kg_cents: i64,
}

pub fn zones() -> &'static HashMap<String, Zone> {
    static ZONES: OnceLock<HashMap<String, Zone>> = OnceLock::new();
    ZONES.get_or_init(|| {
        let path = paths::data().join("shipping_zones.txt");
        let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
        text.lines()
            .map(str::trim)
            .filter(|l| !l.is_empty() && !l.starts_with('#'))
            .map(|line| {
                let cols: Vec<&str> = line.split_whitespace().collect();
                assert_eq!(cols.len(), 3, "zone row needs: name base_cents per_kg_cents");
                let base_cents = cols[1].parse().expect("base_cents");
                let per_kg_cents = cols[2].parse().expect("per_kg_cents");
                (cols[0].to_string(), Zone { base_cents, per_kg_cents })
            })
            .collect()
    })
}

pub fn cost(cart: &Cart, zone: &str) -> Result<Money> {
    if cart.count() == 0 {
        return Ok(zero_usd());
    }
    let free_over = shop_config::get_int("free_shipping_over", 1_000_000_000) * 100;
    if zone == "domestic" && cart.subtotal().cents >= free_over {
        return Ok(zero_usd());
    }
    let z = zones().get(zone).ok_or_else(|| ShopError::Key(format!("no shipping zone {zone}")))?;
    let kg = (cart.weight_g() + 999).div_euclid(1000);
    Ok(Money::new(z.base_cents + z.per_kg_cents * kg))
}

pub fn domestic(cart: &Cart) -> Result<Money> {
    cost(cart, "domestic")
}
