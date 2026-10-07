import pytest

from helpers.factories import cart_of, fixture_orders
from shop.events import Bus
from shop.fulfil.orders import OrderService


def test_place_reserves_and_emits(stocked):
    bus = Bus()
    seen = []
    bus.on("order.placed", seen.append)
    svc = OrderService(stocked, bus)
    order = svc.place(cart_of(SKU_004=2))
    assert order.id == "ORD00001"
    assert stocked.available("SKU-004") == 0
    assert seen == ["ORD00001"]


def test_cancel_releases(stocked):
    svc = OrderService(stocked)
    order = svc.place(cart_of(SKU_006=3))
    svc.cancel(order)
    assert order.state == "cancelled"
    assert stocked.available("SKU-006") == 3


def test_bad_transition(stocked):
    order = OrderService(stocked).place(cart_of(SKU_001=1))
    with pytest.raises(ValueError):
        order.move("shipped")


def test_fixture_orders(stocked):
    svc = OrderService(stocked)
    ids = [svc.place(cart_of(**{k.replace("-", "_"): v for k, v in o["lines"].items()}), o["coupon"]).id
           for o in fixture_orders()]
    assert ids == ["ORD00001", "ORD00002", "ORD00003", "ORD00004"]
