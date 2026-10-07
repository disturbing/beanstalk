package shop.sales;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;
import shop.core.Money;

class TaxTest {
    @Test
    void defaultRegionFromConfig() {
        assertEquals(0.0725, Tax.rate());
    }

    @Test
    void regions() {
        assertEquals(0.0, Tax.rate("OR"));
        assertEquals(new Money(625), Tax.taxOn(new Money(10000), "TX"));
    }
}
