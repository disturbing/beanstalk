package shop.billing;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static shop.testkit.Factories.cartOf;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import shop.catalog.Inventory;
import shop.fulfil.Order;
import shop.fulfil.OrderService;

class InvoiceTest {
    @Test
    void invoiceLines() {
        Order order = new OrderService(new Inventory(Map.of("SKU-003", 10))).place(cartOf("SKU-003", 2));
        List<String> text = Invoice.render(order).lines().toList();
        assertEquals("INVOICE ORD00001", text.get(0));
        assertEquals("2 x Notebook            9.00 USD", text.get(1));
        assertEquals("Total                  16.33 USD", text.get(text.size() - 2));
        assertEquals("Thank you for shopping", text.get(text.size() - 1));
    }
}
