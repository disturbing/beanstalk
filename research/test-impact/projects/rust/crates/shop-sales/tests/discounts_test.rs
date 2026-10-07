use shop_sales::coupons::{parse, Coupon, CouponKind};
use shop_sales::discounts;
use shop_testkit::cart_of;

#[test]
fn percent_off_capped() {
    let cart = cart_of(&[("SKU-002", 2)]);
    assert_eq!(discounts::percent_off(&cart, 10).cents, 700);
    assert_eq!(discounts::percent_off(&cart, 80).cents, 3500);
}

#[test]
fn threshold() {
    let cart = cart_of(&[("SKU-004", 1)]);
    assert_eq!(discounts::threshold_off(&cart, 4000, 500).cents, 500);
    assert_eq!(discounts::threshold_off(&cart, 5000, 500).cents, 0);
}

#[test]
fn bogo() {
    let cart = cart_of(&[("SKU-005", 5)]);
    assert_eq!(discounts::bogo(&cart, "SKU-005").cents, 3600);
}

#[test]
fn coupon_parse() {
    assert_eq!(parse(" pct15 ").unwrap(), Coupon::new(CouponKind::Percent, 15));
    assert_eq!(parse("OFF7").unwrap(), Coupon::new(CouponKind::Amount, 700));
    assert_eq!(parse("freeship").unwrap(), Coupon::new(CouponKind::Shipping, 0));
}
