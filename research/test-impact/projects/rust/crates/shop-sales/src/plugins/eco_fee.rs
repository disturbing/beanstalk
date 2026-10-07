use shop_core::money::Money;

use super::FeePlugin;

/// Flat 25-cent fee. Not enabled in the default config.
pub struct EcoFee;

impl FeePlugin for EcoFee {
    fn name(&self) -> &'static str {
        "eco_fee"
    }

    fn fee(&self, _base: &Money) -> Money {
        Money::new(25)
    }
}
