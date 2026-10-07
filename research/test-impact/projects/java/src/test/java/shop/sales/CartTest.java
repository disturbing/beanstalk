package shop.sales;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static shop.testkit.Factories.cartOf;

import org.junit.jupiter.api.Test;

class CartTest {
    @Test
    void subtotal() {
        Cart cart = cartOf("SKU-001", 2, "SKU-003", 1);
        assertEquals(2850, cart.subtotal().cents());
    }

    @Test
    void addMergesLines() {
        Cart cart = cartOf("SKU-001", 1);
        cart.add("SKU-001", 2);
        assertEquals(3, cart.count());
        assertEquals(1, cart.lines().size());
    }

    @Test
    void removeAndWeight() {
        Cart cart = cartOf("SKU-002", 1, "SKU-005", 2);
        assertEquals(1560, cart.weightG());
        cart.remove("SKU-002");
        assertEquals(360, cart.weightG());
    }
}
