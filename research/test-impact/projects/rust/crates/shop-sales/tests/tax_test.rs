use shop_core::money::Money;
use shop_sales::tax::{rate, tax_on};

#[test]
fn default_region_from_config() {
    assert_eq!(rate(None).unwrap(), 0.0725);
}

#[test]
fn regions() {
    assert_eq!(rate(Some("OR")).unwrap(), 0.0);
    assert_eq!(tax_on(&Money::new(10000), Some("TX")).unwrap(), Money::new(625));
}
