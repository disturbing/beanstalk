import pytest

from shop.catalog.products import by_category, catalog, find


def test_catalog_size():
    assert len(catalog()) == 6


def test_find():
    p = find("SKU-002")
    assert p.name == "Tea Kettle"
    assert p.price.cents == 3500


def test_missing():
    with pytest.raises(KeyError):
        find("SKU-999")


def test_by_category():
    assert [p.sku for p in by_category("office")] == ["SKU-003", "SKU-004"]
