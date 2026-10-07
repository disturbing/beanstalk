use std::cell::RefCell;
use std::rc::Rc;

use shop_core::ShopError;
use shop_fulfil::events::Bus;
use shop_fulfil::orders::{OrderService, OrderState};
use shop_testkit::{cart_of, fixture_orders, stocked};

#[test]
fn place_reserves_and_emits() {
    let mut inv = stocked();
    let mut bus = Bus::new();
    let seen = Rc::new(RefCell::new(Vec::<String>::new()));
    let sink = Rc::clone(&seen);
    bus.on("order.placed", move |id| sink.borrow_mut().push(id.to_string()));
    let mut svc = OrderService::with_bus(&mut inv, bus);
    let order = svc.place(cart_of(&[("SKU-004", 2)]), None).unwrap();
    assert_eq!(order.id, "ORD00001");
    assert_eq!(inv.available("SKU-004"), 0);
    assert_eq!(*seen.borrow(), ["ORD00001"]);
}

#[test]
fn cancel_releases() {
    let mut inv = stocked();
    let mut svc = OrderService::new(&mut inv);
    let mut order = svc.place(cart_of(&[("SKU-006", 3)]), None).unwrap();
    svc.cancel(&mut order).unwrap();
    assert_eq!(order.state, OrderState::Cancelled);
    assert_eq!(inv.available("SKU-006"), 3);
}

#[test]
fn bad_transition() {
    let mut inv = stocked();
    let mut order = OrderService::new(&mut inv).place(cart_of(&[("SKU-001", 1)]), None).unwrap();
    assert!(matches!(order.move_to(OrderState::Shipped), Err(ShopError::Value(_))));
}

#[test]
fn fixture_orders_get_sequential_ids() {
    let mut inv = stocked();
    let mut svc = OrderService::new(&mut inv);
    let ids: Vec<String> =
        fixture_orders().iter().map(|o| svc.place(o.cart(), o.coupon()).unwrap().id).collect();
    assert_eq!(ids, ["ORD00001", "ORD00002", "ORD00003", "ORD00004"]);
}
