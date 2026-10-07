import re

SKU_RE = re.compile(r"^SKU-\d{3}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[a-z]{2,}$")


def is_sku(value: str) -> bool:
    return bool(SKU_RE.match(value))


def is_email(value: str) -> bool:
    return bool(EMAIL_RE.match(value))


def require(cond: bool, message: str) -> None:
    if not cond:
        raise ValueError(message)
