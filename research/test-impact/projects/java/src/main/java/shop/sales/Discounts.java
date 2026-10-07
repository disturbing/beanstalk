package shop.sales;

import shop.config.AppConfig;
import shop.core.Money;

public final class Discounts {
    private Discounts() {
    }

    public static Money percentOff(Cart cart, long pct) {
        long cap = AppConfig.getLong("max_discount_pct", 100);
        return cart.subtotal().pct(Math.min(pct, cap) / 100.0);
    }

    public static Money thresholdOff(Cart cart, long overCents, long offCents) {
        if (cart.subtotal().cents() >= overCents) {
            return new Money(offCents);
        }
        return Money.zero();
    }

    public static Money bogo(Cart cart, String sku) {
        Line line = cart.lines().get(sku);
        if (line == null) {
            return Money.zero();
        }
        return line.product().price().times(line.qty() / 2);
    }
}
