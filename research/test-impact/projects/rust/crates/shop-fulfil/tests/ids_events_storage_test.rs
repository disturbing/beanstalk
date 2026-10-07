use std::cell::RefCell;
use std::rc::Rc;

use shop_core::ids::{short_id, Sequence};
use shop_fulfil::events::Bus;
use shop_fulfil::storage::Repo;

#[test]
fn sequence() {
    let mut s = Sequence::starting_at("X", 9);
    assert_eq!([s.take(), s.take()], ["X00009", "X00010"]);
}

#[test]
fn short_id_stable() {
    assert_eq!(short_id("c", &[&"a", &1]), short_id("c", &[&"a", &1]));
    assert!(short_id("c", &[&"a", &1]).starts_with("c-"));
}

#[test]
fn bus_and_repo() {
    let mut bus = Bus::new();
    let repo: Rc<RefCell<Repo<String>>> = Rc::new(RefCell::new(Repo::new()));
    let sink = Rc::clone(&repo);
    bus.on("t", move |p| sink.borrow_mut().put(p, p.to_uppercase()));
    bus.emit("t", "b");
    bus.emit("t", "a");
    assert_eq!(repo.borrow().all(), ["A", "B"]);
}
