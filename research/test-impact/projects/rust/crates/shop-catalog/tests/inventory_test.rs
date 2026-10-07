use shop_core::ShopError;
use shop_testkit::stocked;

#[test]
fn reserve_and_release() {
    let mut inv = stocked();
    inv.reserve("SKU-004", 2).unwrap();
    assert_eq!(inv.available("SKU-004"), 0);
    inv.release("SKU-004", 1);
    assert_eq!(inv.available("SKU-004"), 1);
}

#[test]
fn out_of_stock() {
    let mut inv = stocked();
    assert!(matches!(inv.reserve("SKU-006", 4), Err(ShopError::OutOfStock(_))));
}

#[test]
fn commit() {
    let mut inv = stocked();
    inv.reserve("SKU-001", 3).unwrap();
    inv.commit("SKU-001", 3);
    assert_eq!(inv.levels["SKU-001"], 7);
    assert_eq!(inv.available("SKU-001"), 7);
}

#[test]
fn bad_qty() {
    let mut inv = stocked();
    assert!(matches!(inv.reserve("SKU-001", 0), Err(ShopError::Value(_))));
}
