package shop.fulfil;

import java.util.NoSuchElementException;
import java.util.Properties;
import shop.config.AppConfig;
import shop.config.Resources;
import shop.core.Money;
import shop.sales.Cart;

public final class Shipping {
    private static Properties zones;

    private Shipping() {
    }

    public static synchronized Properties zones() {
        if (zones == null) {
            zones = Resources.properties("data/shipping_zones.properties");
        }
        return zones;
    }

    public static Money cost(Cart cart) {
        return cost(cart, "domestic");
    }

    public static Money cost(Cart cart, String zone) {
        if (cart.count() == 0) {
            return Money.zero();
        }
        if (zone.equals("domestic")
                && cart.subtotal().cents() >= AppConfig.getLong("free_shipping_over", 1_000_000_000L) * 100) {
            return Money.zero();
        }
        long kg = Math.ceilDiv(cart.weightG(), 1000);
        return new Money(zoneValue(zone, "base_cents") + zoneValue(zone, "per_kg_cents") * kg);
    }

    private static long zoneValue(String zone, String field) {
        String v = zones().getProperty(zone + "." + field);
        if (v == null) {
            throw new NoSuchElementException(zone);
        }
        return Long.parseLong(v.trim());
    }
}
