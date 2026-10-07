import json
from functools import lru_cache

from shop.paths import CONFIG


@lru_cache(maxsize=1)
def load() -> dict:
    with open(CONFIG / "app.json") as f:
        return json.load(f)


def get(key: str, default=None):
    return load().get(key, default)
