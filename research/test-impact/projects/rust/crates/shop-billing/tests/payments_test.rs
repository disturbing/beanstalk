use shop_billing::payments::{charge, luhn_ok};
use shop_core::money::Money;

#[test]
fn luhn() {
    assert!(luhn_ok("4539 1488 0343 6467"));
    assert!(!luhn_ok("4539 1488 0343 6468"));
    assert!(!luhn_ok("1234"));
}

#[test]
fn charge_card() {
    assert_eq!(charge("4539148803436467", &Money::new(100)), "approved");
    assert_eq!(charge("4539148803436468", &Money::new(100)), "rejected:card");
    assert_eq!(charge("4539148803436467", &Money::new(0)), "rejected:amount");
}
