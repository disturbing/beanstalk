use shop_core::money::Money;
use shop_sales::plugins;

#[test]
fn configured_fees() {
    assert_eq!(plugins::total_fees(&Money::new(10000)).cents, 200);
}

#[test]
fn load_by_name() {
    let p = plugins::plugin("service_fee").expect("service_fee is registered");
    assert_eq!(p.fee(&Money::new(500)).cents, 10);
}
