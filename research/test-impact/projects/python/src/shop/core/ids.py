import hashlib


def short_id(prefix: str, *parts: object) -> str:
    digest = hashlib.sha1("|".join(str(p) for p in parts).encode()).hexdigest()
    return f"{prefix}-{digest[:8]}"


class Sequence:
    def __init__(self, prefix: str, start: int = 1):
        self.prefix = prefix
        self.next = start

    def take(self) -> str:
        value = f"{self.prefix}{self.next:05d}"
        self.next += 1
        return value
