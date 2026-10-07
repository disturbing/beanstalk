use shop_testkit::cart_of;

#[test]
fn subtotal() {
    let cart = cart_of(&[("SKU-001", 2), ("SKU-003", 1)]);
    assert_eq!(cart.subtotal().cents, 2850);
}

#[test]
fn add_merges_lines() {
    let mut cart = cart_of(&[("SKU-001", 1)]);
    cart.add("SKU-001", 2).unwrap();
    assert_eq!(cart.count(), 3);
    assert_eq!(cart.lines.len(), 1);
}

#[test]
fn remove_and_weight() {
    let mut cart = cart_of(&[("SKU-002", 1), ("SKU-005", 2)]);
    assert_eq!(cart.weight_g(), 1560);
    cart.remove("SKU-002");
    assert_eq!(cart.weight_g(), 360);
}
