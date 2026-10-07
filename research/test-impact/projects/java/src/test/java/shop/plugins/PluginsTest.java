package shop.plugins;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;
import shop.core.Money;

class PluginsTest {
    @Test
    void configuredFees() {
        assertEquals(200, Plugins.totalFees(new Money(10000)).cents());
    }

    @Test
    void loadByName() {
        assertEquals(10, Plugins.load("service_fee").fee(new Money(500)).cents());
    }
}
