"""Fee plugins, loaded by name from config (a dynamic import)."""
import importlib

from shop import config
from shop.core.money import Money, zero


def load(name: str):
    return importlib.import_module(f"shop.plugins.{name}")


def total_fees(base: Money) -> Money:
    total = zero()
    for name in config.get("fee_plugins", []):
        total = total + load(name).fee(base)
    return total
