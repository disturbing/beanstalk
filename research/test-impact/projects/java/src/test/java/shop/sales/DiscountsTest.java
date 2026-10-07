package shop.sales;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static shop.testkit.Factories.cartOf;

import org.junit.jupiter.api.Test;

class DiscountsTest {
    @Test
    void percentOffCapped() {
        Cart cart = cartOf("SKU-002", 2);
        assertEquals(700, Discounts.percentOff(cart, 10).cents());
        assertEquals(3500, Discounts.percentOff(cart, 80).cents());
    }

    @Test
    void threshold() {
        Cart cart = cartOf("SKU-004", 1);
        assertEquals(500, Discounts.thresholdOff(cart, 4000, 500).cents());
        assertEquals(0, Discounts.thresholdOff(cart, 5000, 500).cents());
    }

    @Test
    void bogo() {
        Cart cart = cartOf("SKU-005", 5);
        assertEquals(3600, Discounts.bogo(cart, "SKU-005").cents());
    }

    @Test
    void couponParse() {
        assertEquals(new Coupon("percent", 15), Coupons.parse(" pct15 "));
        assertEquals(new Coupon("amount", 700), Coupons.parse("OFF7"));
        assertEquals(new Coupon("shipping", 0), Coupons.parse("freeship"));
    }
}
