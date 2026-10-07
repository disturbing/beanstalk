package shop.sales;

import java.util.Locale;

public final class Coupons {
    private Coupons() {
    }

    public static Coupon parse(String raw) {
        String code = raw.strip().toUpperCase(Locale.ROOT);
        if (code.startsWith("PCT")) {
            return new Coupon("percent", Long.parseLong(code.substring(3)));
        }
        if (code.startsWith("OFF")) {
            return new Coupon("amount", Long.parseLong(code.substring(3)) * 100);
        }
        if (code.equals("FREESHIP")) {
            return new Coupon("shipping", 0);
        }
        throw new IllegalArgumentException("unknown coupon " + code);
    }
}
