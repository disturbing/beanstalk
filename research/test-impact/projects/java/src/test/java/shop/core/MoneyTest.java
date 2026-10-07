package shop.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

class MoneyTest {
    @Test
    void addAndSub() {
        assertEquals(new Money(400), new Money(150).plus(new Money(250)));
        assertEquals(new Money(380), new Money(500).minus(new Money(120)));
    }

    @Test
    void currencyMismatch() {
        assertThrows(IllegalArgumentException.class, () -> new Money(1, "USD").plus(new Money(1, "EUR")));
    }

    @Test
    void pctRoundsHalfUp() {
        assertEquals(new Money(73), new Money(1000).pct(0.0725));
        assertEquals(3, Money.roundHalfUp(2.5));
        assertEquals(-3, Money.roundHalfUp(-2.5));
    }

    @Test
    void format() {
        assertEquals("1234.56 USD", new Money(123456).format());
        assertEquals("-0.05 USD", new Money(-5).format());
        assertEquals("0.00 EUR", Money.zero("EUR").format());
    }
}
