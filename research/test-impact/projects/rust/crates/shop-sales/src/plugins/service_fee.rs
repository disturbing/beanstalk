use shop_core::money::Money;

use super::FeePlugin;

pub const RATE: f64 = 0.02;

pub struct ServiceFee;

impl FeePlugin for ServiceFee {
    fn name(&self) -> &'static str {
        "service_fee"
    }

    fn fee(&self, base: &Money) -> Money {
        base.pct(RATE)
    }
}
