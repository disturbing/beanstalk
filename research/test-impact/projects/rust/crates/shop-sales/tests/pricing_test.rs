use shop_sales::pricing::{quote, quote_with};
use shop_testkit::cart_of;

#[test]
fn plain_quote() {
    let q = quote(&cart_of(&[("SKU-001", 2)]), None).unwrap();
    assert_eq!(q.subtotal.cents, 2400);
    assert_eq!(q.shipping.cents, 650);
    assert_eq!(q.fees.cents, 48);
    assert_eq!(q.tax.cents, 174);
    assert_eq!(q.total().cents, 2400 + 650 + 48 + 174);
}

#[test]
fn percent_coupon() {
    let q = quote(&cart_of(&[("SKU-002", 1)]), Some("PCT10")).unwrap();
    assert_eq!(q.discount.cents, 350);
    assert_eq!(q.tax.cents, 228);
}

#[test]
fn freeship_coupon() {
    let q = quote_with(&cart_of(&[("SKU-004", 1)]), Some("FREESHIP"), "domestic", Some("OR")).unwrap();
    assert_eq!(q.shipping.cents, 0);
    assert_eq!(q.tax.cents, 0);
}
