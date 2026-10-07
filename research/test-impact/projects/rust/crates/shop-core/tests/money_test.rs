use shop_core::money::{round_half_up, zero, Money};
use shop_core::ShopError;

#[test]
fn add_and_sub() {
    assert_eq!(Money::new(150) + Money::new(250), Money::new(400));
    assert_eq!(Money::new(500) - Money::new(120), Money::new(380));
}

#[test]
fn currency_mismatch() {
    let err = Money::of(1, "USD").try_add(&Money::of(1, "EUR")).unwrap_err();
    assert!(matches!(err, ShopError::Value(_)));
}

#[test]
fn pct_rounds_half_up() {
    assert_eq!(Money::new(1000).pct(0.0725), Money::new(73));
    assert_eq!(round_half_up(2.5), 3);
    assert_eq!(round_half_up(-2.5), -3);
}

#[test]
fn format() {
    assert_eq!(Money::new(123456).format(), "1234.56 USD");
    assert_eq!(Money::new(-5).format(), "-0.05 USD");
    assert_eq!(zero("EUR").format(), "0.00 EUR");
}
