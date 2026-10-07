//! Tax rates, compiled in from `data/tax.txt` (a deliberate compile-time file dependency).

use std::collections::HashMap;
use std::sync::OnceLock;

use shop_core::money::Money;
use shop_core::{Result, ShopError};

const TAX_TABLE: &str = include_str!("../../../data/tax.txt");

pub fn table() -> &'static HashMap<String, f64> {
    static TABLE: OnceLock<HashMap<String, f64>> = OnceLock::new();
    TABLE.get_or_init(|| {
        TAX_TABLE
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty() && !l.starts_with('#'))
            .map(|line| {
                let (region, rate) = line.split_once(char::is_whitespace).expect("tax row needs region rate");
                (region.to_string(), rate.trim().parse::<f64>().expect("tax rate must be a number"))
            })
            .collect()
    })
}

/// Rate for `region`, or for the configured `tax_region` when `None`.
pub fn rate(region: Option<&str>) -> Result<f64> {
    let region = match region {
        Some(r) => r.to_string(),
        None => shop_config::get_str("tax_region", ""),
    };
    table().get(&region).copied().ok_or_else(|| ShopError::Key(format!("no tax rate for {region}")))
}

pub fn tax_on(amount: &Money, region: Option<&str>) -> Result<Money> {
    Ok(amount.pct(rate(region)?))
}
