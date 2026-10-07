use shop_catalog::inventory::Inventory;
use shop_fulfil::orders::{Order, OrderService};
use shop_reports::sales::{revenue, top_skus};
use shop_testkit::{fixture_orders, stocked};

fn orders(inv: &mut Inventory) -> Vec<Order> {
    let mut svc = OrderService::new(inv);
    let mut out: Vec<Order> =
        fixture_orders().iter().map(|o| svc.place(o.cart(), o.coupon()).unwrap()).collect();
    svc.cancel(&mut out[1]).unwrap();
    out
}

#[test]
fn top_skus_ranked() {
    let mut inv = stocked();
    let expected = [("SKU-003".to_string(), 4), ("SKU-005".to_string(), 3), ("SKU-001".to_string(), 2)];
    assert_eq!(top_skus(&orders(&mut inv), 3), expected);
}

#[test]
fn revenue_skips_cancelled() {
    let mut inv = stocked();
    assert!(revenue(&orders(&mut inv)).cents > 0);
}
