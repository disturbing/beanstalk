from helpers.factories import cart_of
from shop.billing.invoice import render
from shop.catalog.inventory import Inventory
from shop.fulfil.orders import OrderService


def test_invoice_lines():
    order = OrderService(Inventory({"SKU-003": 10})).place(cart_of(SKU_003=2))
    text = render(order).splitlines()
    assert text[0] == "INVOICE ORD00001"
    assert text[1] == "2 x Notebook            9.00 USD"
    assert text[-2] == "Total                  16.33 USD"
    assert text[-1] == "Thank you for shopping"
