import re


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def pad_right(text: str, width: int) -> str:
    return text[:width].ljust(width)


def pad_left(text: str, width: int) -> str:
    return text[:width].rjust(width)
