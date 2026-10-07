package shop.fulfil;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static shop.testkit.Factories.cartOf;

import org.junit.jupiter.api.Test;
import shop.sales.Cart;

class ShippingTest {
    @Test
    void emptyCartShipsFree() {
        assertEquals(0, Shipping.cost(new Cart()).cents());
    }

    @Test
    void domesticByWeight() {
        assertEquals(500 + 150 * 2, Shipping.cost(cartOf("SKU-002", 1)).cents());
    }

    @Test
    void freeOverThreshold() {
        assertEquals(0, Shipping.cost(cartOf("SKU-006", 3)).cents());
    }

    @Test
    void intl() {
        assertEquals(1500 + 600, Shipping.cost(cartOf("SKU-001", 1), "intl").cents());
    }
}
