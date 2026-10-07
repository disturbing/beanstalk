from shop import config
from shop.fulfil.orders import Order
from shop.util.strings import pad_left, pad_right

WIDTH = 32


def render(order: Order) -> str:
    rows = [f"INVOICE {order.id}"]
    for sku, line in sorted(order.cart.lines.items()):
        rows.append(pad_right(f"{line.qty} x {line.product.name}", 20) + pad_left(line.total.format(), 12))
    q = order.quote
    for label, amount in (("Subtotal", q.subtotal), ("Discount", q.discount), ("Shipping", q.shipping),
                          ("Fees", q.fees), ("Tax", q.tax), ("Total", q.total)):
        rows.append(pad_right(label, 20) + pad_left(amount.format(), 12))
    rows.append(config.get("invoice_footer", ""))
    return "\n".join(rows)
