import pytest

from shop.catalog.inventory import Inventory


@pytest.fixture
def stocked() -> Inventory:
    return Inventory({"SKU-001": 10, "SKU-002": 5, "SKU-003": 100, "SKU-004": 2, "SKU-005": 20, "SKU-006": 3})
