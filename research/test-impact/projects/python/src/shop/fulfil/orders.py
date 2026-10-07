from dataclasses import dataclass, field

from shop.catalog.inventory import Inventory
from shop.core.ids import Sequence
from shop.events import Bus
from shop.sales.cart import Cart
from shop.sales.pricing import Quote, quote

TRANSITIONS = {
    "new": {"paid", "cancelled"},
    "paid": {"shipped", "refunded"},
    "shipped": {"delivered"},
}


@dataclass
class Order:
    id: str
    cart: Cart
    quote: Quote
    state: str = "new"
    history: list[str] = field(default_factory=list)

    def move(self, to: str) -> None:
        if to not in TRANSITIONS.get(self.state, set()):
            raise ValueError(f"cannot go {self.state} -> {to}")
        self.history.append(self.state)
        self.state = to


class OrderService:
    def __init__(self, inventory: Inventory, bus: Bus | None = None):
        self.inventory = inventory
        self.bus = bus or Bus()
        self.seq = Sequence("ORD")

    def place(self, cart: Cart, coupon: str | None = None) -> Order:
        for sku, line in cart.lines.items():
            self.inventory.reserve(sku, line.qty)
        order = Order(self.seq.take(), cart, quote(cart, coupon))
        self.bus.emit("order.placed", order.id)
        return order

    def cancel(self, order: Order) -> None:
        order.move("cancelled")
        for sku, line in order.cart.lines.items():
            self.inventory.release(sku, line.qty)
        self.bus.emit("order.cancelled", order.id)
