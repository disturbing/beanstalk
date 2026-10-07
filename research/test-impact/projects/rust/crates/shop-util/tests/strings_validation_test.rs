use shop_util::strings::{pad_left, pad_right, slugify};
use shop_util::validation::{is_email, is_sku};

#[test]
fn slugify_text() {
    assert_eq!(slugify("Desk Lamp (Large)!"), "desk-lamp-large");
}

#[test]
fn pads() {
    assert_eq!(pad_right("ab", 4), "ab  ");
    assert_eq!(pad_left("ab", 4), "  ab");
    assert_eq!(pad_right("abcdef", 3), "abc");
}

#[test]
fn validation() {
    assert!(is_sku("SKU-123"));
    assert!(!is_sku("SKU-12"));
    assert!(is_email("a@b.io"));
    assert!(!is_email("a@b"));
}
