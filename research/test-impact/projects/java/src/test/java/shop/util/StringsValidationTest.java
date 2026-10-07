package shop.util;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class StringsValidationTest {
    @Test
    void slugify() {
        assertEquals("desk-lamp-large", Strings.slugify("Desk Lamp (Large)!"));
    }

    @Test
    void pads() {
        assertEquals("ab  ", Strings.padRight("ab", 4));
        assertEquals("  ab", Strings.padLeft("ab", 4));
        assertEquals("abc", Strings.padRight("abcdef", 3));
    }

    @Test
    void validation() {
        assertTrue(Validation.isSku("SKU-123"));
        assertFalse(Validation.isSku("SKU-12"));
        assertTrue(Validation.isEmail("a@b.io"));
        assertFalse(Validation.isEmail("a@b"));
    }
}
