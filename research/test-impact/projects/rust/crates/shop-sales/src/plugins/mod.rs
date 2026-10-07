//! Fee plugins, selected by name from config (`fee_plugins`).

pub mod eco_fee;
pub mod service_fee;

use shop_core::money::{zero_usd, Money};

pub trait FeePlugin {
    fn name(&self) -> &'static str;
    fn fee(&self, base: &Money) -> Money;
}

/// Registry: resolve a plugin by its config name.
pub fn plugin(name: &str) -> Option<Box<dyn FeePlugin>> {
    match name {
        "service_fee" => Some(Box::new(service_fee::ServiceFee)),
        "eco_fee" => Some(Box::new(eco_fee::EcoFee)),
        _ => None,
    }
}

/// Sum of fees from every plugin enabled in config. Panics on an unknown name
/// (the Python version fails the import).
pub fn total_fees(base: &Money) -> Money {
    shop_config::get_list("fee_plugins").iter().fold(zero_usd(), |total, name| {
        let p = plugin(name).unwrap_or_else(|| panic!("unknown fee plugin {name}"));
        total + p.fee(base)
    })
}
