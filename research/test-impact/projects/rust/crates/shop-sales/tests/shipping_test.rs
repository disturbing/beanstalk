use shop_sales::cart::Cart;
use shop_sales::shipping::cost;
use shop_testkit::cart_of;

#[test]
fn empty_cart_ships_free() {
    assert_eq!(cost(&Cart::new(), "domestic").unwrap().cents, 0);
}

#[test]
fn domestic_by_weight() {
    assert_eq!(cost(&cart_of(&[("SKU-002", 1)]), "domestic").unwrap().cents, 500 + 150 * 2);
}

#[test]
fn free_over_threshold() {
    assert_eq!(cost(&cart_of(&[("SKU-006", 3)]), "domestic").unwrap().cents, 0);
}

#[test]
fn intl() {
    assert_eq!(cost(&cart_of(&[("SKU-001", 1)]), "intl").unwrap().cents, 1500 + 600);
}
