package shop.sales;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static shop.testkit.Factories.cartOf;

import org.junit.jupiter.api.Test;

class PricingTest {
    @Test
    void plainQuote() {
        Quote q = Pricing.quote(cartOf("SKU-001", 2));
        assertEquals(2400, q.subtotal().cents());
        assertEquals(650, q.shipping().cents());
        assertEquals(48, q.fees().cents());
        assertEquals(174, q.tax().cents());
        assertEquals(2400 + 650 + 48 + 174, q.total().cents());
    }

    @Test
    void percentCoupon() {
        Quote q = Pricing.quote(cartOf("SKU-002", 1), "PCT10");
        assertEquals(350, q.discount().cents());
        assertEquals(228, q.tax().cents());
    }

    @Test
    void freeshipCoupon() {
        Quote q = Pricing.quote(cartOf("SKU-004", 1), "FREESHIP", "domestic", "OR");
        assertEquals(0, q.shipping().cents());
        assertEquals(0, q.tax().cents());
    }
}
