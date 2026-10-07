import pytest

from shop.catalog.inventory import OutOfStock


def test_reserve_and_release(stocked):
    stocked.reserve("SKU-004", 2)
    assert stocked.available("SKU-004") == 0
    stocked.release("SKU-004", 1)
    assert stocked.available("SKU-004") == 1


def test_out_of_stock(stocked):
    with pytest.raises(OutOfStock):
        stocked.reserve("SKU-006", 4)


def test_commit(stocked):
    stocked.reserve("SKU-001", 3)
    stocked.commit("SKU-001", 3)
    assert stocked.levels["SKU-001"] == 7
    assert stocked.available("SKU-001") == 7


def test_bad_qty(stocked):
    with pytest.raises(ValueError):
        stocked.reserve("SKU-001", 0)
