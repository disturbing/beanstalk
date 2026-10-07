use shop_core::currency::{convert, rates};
use shop_core::money::Money;
use shop_core::ShopError;

#[test]
fn rates_loaded() {
    assert_eq!(rates()["EUR"], 0.9);
    assert_eq!(rates().len(), 5);
}

#[test]
fn convert_usd_to_jpy() {
    assert_eq!(convert(&Money::new(1000), "JPY").unwrap(), Money::of(150000, "JPY"));
}

#[test]
fn convert_round_trip() {
    let eur = convert(&Money::new(1000), "EUR").unwrap();
    assert_eq!(eur, Money::of(900, "EUR"));
    assert_eq!(convert(&eur, "USD").unwrap(), Money::new(1000));
}

#[test]
fn unknown_currency() {
    assert!(matches!(convert(&Money::new(1), "XXX"), Err(ShopError::Key(_))));
}
