package shop.billing;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;
import shop.core.Money;

class PaymentsTest {
    @Test
    void luhn() {
        assertTrue(Payments.luhnOk("4539 1488 0343 6467"));
        assertFalse(Payments.luhnOk("4539 1488 0343 6468"));
        assertFalse(Payments.luhnOk("1234"));
    }

    @Test
    void charge() {
        assertEquals("approved", Payments.charge("4539148803436467", new Money(100)));
        assertEquals("rejected:card", Payments.charge("4539148803436468", new Money(100)));
        assertEquals("rejected:amount", Payments.charge("4539148803436467", new Money(0)));
    }
}
