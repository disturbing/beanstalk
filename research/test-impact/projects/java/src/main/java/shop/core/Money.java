package shop.core;

public record Money(long cents, String currency) {
    public static final String DEFAULT_CURRENCY = "USD";

    public Money(long cents) {
        this(cents, DEFAULT_CURRENCY);
    }

    public Money plus(Money other) {
        same(this, other);
        return new Money(cents + other.cents, currency);
    }

    public Money minus(Money other) {
        same(this, other);
        return new Money(cents - other.cents, currency);
    }

    public Money times(long qty) {
        return new Money(cents * qty, currency);
    }

    public Money pct(double rate) {
        return new Money(roundHalfUp(cents * rate), currency);
    }

    public String format() {
        String sign = cents < 0 ? "-" : "";
        long abs = Math.abs(cents);
        return String.format("%s%d.%02d %s", sign, abs / 100, abs % 100, currency);
    }

    public static long roundHalfUp(double x) {
        return x >= 0 ? (long) (x + 0.5) : -(long) (-x + 0.5);
    }

    public static Money zero() {
        return zero(DEFAULT_CURRENCY);
    }

    public static Money zero(String currency) {
        return new Money(0, currency);
    }

    private static void same(Money a, Money b) {
        if (!a.currency.equals(b.currency)) {
            throw new IllegalArgumentException("currency mismatch " + a.currency + " != " + b.currency);
        }
    }
}
