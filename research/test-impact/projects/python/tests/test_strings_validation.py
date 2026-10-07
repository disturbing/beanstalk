from shop.util.strings import pad_left, pad_right, slugify
from shop.util.validation import is_email, is_sku


def test_slugify():
    assert slugify("Desk Lamp (Large)!") == "desk-lamp-large"


def test_pads():
    assert pad_right("ab", 4) == "ab  "
    assert pad_left("ab", 4) == "  ab"
    assert pad_right("abcdef", 3) == "abc"


def test_validation():
    assert is_sku("SKU-123")
    assert not is_sku("SKU-12")
    assert is_email("a@b.io")
    assert not is_email("a@b")
