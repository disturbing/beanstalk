use shop_catalog::inventory::Inventory;
use shop_sales::cart::Cart;

/// A cart holding the given `(sku, qty)` lines.
pub fn cart_of(lines: &[(&str, i64)]) -> Cart {
    let mut cart = Cart::new();
    for (sku, qty) in lines {
        cart.add(sku, *qty).unwrap_or_else(|e| panic!("cart_of {sku}: {e}"));
    }
    cart
}

/// The shared stocked inventory (the Python `stocked` fixture).
pub fn stocked() -> Inventory {
    Inventory::new(&[("SKU-001", 10), ("SKU-002", 5), ("SKU-003", 100), ("SKU-004", 2), ("SKU-005", 20), ("SKU-006", 3)])
}
