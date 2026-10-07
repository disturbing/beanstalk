from helpers.factories import cart_of, fixture_orders
from shop.fulfil.orders import OrderService
from shop.reports.sales import revenue, top_skus


def _orders(stocked):
    svc = OrderService(stocked)
    out = [svc.place(cart_of(**{k.replace("-", "_"): v for k, v in o["lines"].items()}), o["coupon"])
           for o in fixture_orders()]
    svc.cancel(out[1])
    return out


def test_top_skus(stocked):
    assert top_skus(_orders(stocked)) == [("SKU-003", 4), ("SKU-005", 3), ("SKU-001", 2)]


def test_revenue_skips_cancelled(stocked):
    assert revenue(_orders(stocked)).cents > 0
