//! Currency conversion using `data/rates.csv` (read once at runtime).

use std::collections::HashMap;
use std::sync::OnceLock;

use crate::money::{round_half_up, Money};
use crate::{paths, Result, ShopError};

pub fn rates() -> &'static HashMap<String, f64> {
    static RATES: OnceLock<HashMap<String, f64>> = OnceLock::new();
    RATES.get_or_init(|| {
        let path = paths::data().join("rates.csv");
        let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
        text.lines()
            .skip(1)
            .filter(|l| !l.trim().is_empty())
            .map(|line| {
                let (code, rate) = line.split_once(',').expect("rates row needs code,per_usd");
                (code.trim().to_string(), rate.trim().parse::<f64>().expect("rate must be a number"))
            })
            .collect()
    })
}

pub fn convert(m: &Money, to: &str) -> Result<Money> {
    let table = rates();
    let (Some(from_rate), Some(to_rate)) = (table.get(&m.currency), table.get(to)) else {
        return Err(ShopError::Key(format!("unknown currency {}->{}", m.currency, to)));
    };
    let usd = m.cents as f64 / from_rate;
    Ok(Money::of(round_half_up(usd * to_rate), to))
}
