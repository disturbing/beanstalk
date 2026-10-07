from dataclasses import dataclass


@dataclass(frozen=True)
class Coupon:
    kind: str
    value: int


def parse(code: str) -> Coupon:
    code = code.strip().upper()
    if code.startswith("PCT"):
        return Coupon("percent", int(code[3:]))
    if code.startswith("OFF"):
        return Coupon("amount", int(code[3:]) * 100)
    if code == "FREESHIP":
        return Coupon("shipping", 0)
    raise ValueError(f"unknown coupon {code}")
