package shop.catalog;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.List;
import java.util.NoSuchElementException;
import org.junit.jupiter.api.Test;

class CatalogTest {
    @Test
    void catalogSize() {
        assertEquals(6, Catalog.catalog().size());
    }

    @Test
    void find() {
        Product p = Catalog.find("SKU-002");
        assertEquals("Tea Kettle", p.name());
        assertEquals(3500, p.price().cents());
    }

    @Test
    void missing() {
        assertThrows(NoSuchElementException.class, () -> Catalog.find("SKU-999"));
    }

    @Test
    void byCategory() {
        assertEquals(List.of("SKU-003", "SKU-004"),
                Catalog.byCategory("office").stream().map(Product::sku).toList());
    }
}
