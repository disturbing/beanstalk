package shop.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.NoSuchElementException;
import org.junit.jupiter.api.Test;

class CurrencyTest {
    @Test
    void ratesLoaded() {
        assertEquals(0.9, Currency.rates().get("EUR"));
        assertEquals(5, Currency.rates().size());
    }

    @Test
    void convertUsdToJpy() {
        assertEquals(new Money(150000, "JPY"), Currency.convert(new Money(1000), "JPY"));
    }

    @Test
    void convertRoundTrip() {
        Money eur = Currency.convert(new Money(1000), "EUR");
        assertEquals(new Money(900, "EUR"), eur);
        assertEquals(new Money(1000), Currency.convert(eur, "USD"));
    }

    @Test
    void unknownCurrency() {
        assertThrows(NoSuchElementException.class, () -> Currency.convert(new Money(1), "XXX"));
    }
}
