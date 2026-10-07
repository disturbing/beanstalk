package shop.catalog;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import shop.testkit.Factories;

class InventoryTest {
    private Inventory stocked;

    @BeforeEach
    void setUp() {
        stocked = Factories.stocked();
    }

    @Test
    void reserveAndRelease() {
        stocked.reserve("SKU-004", 2);
        assertEquals(0, stocked.available("SKU-004"));
        stocked.release("SKU-004", 1);
        assertEquals(1, stocked.available("SKU-004"));
    }

    @Test
    void outOfStock() {
        assertThrows(OutOfStockException.class, () -> stocked.reserve("SKU-006", 4));
    }

    @Test
    void commit() {
        stocked.reserve("SKU-001", 3);
        stocked.commit("SKU-001", 3);
        assertEquals(7, stocked.levels().get("SKU-001"));
        assertEquals(7, stocked.available("SKU-001"));
    }

    @Test
    void badQty() {
        assertThrows(IllegalArgumentException.class, () -> stocked.reserve("SKU-001", 0));
    }
}
