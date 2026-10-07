package shop.plugins;

import java.util.Map;
import java.util.NoSuchElementException;
import java.util.function.Supplier;
import shop.config.AppConfig;
import shop.core.Money;

/** Fee plugins, selected by name from config through a static registry. */
public final class Plugins {
    private static final Map<String, Supplier<FeePlugin>> REGISTRY = Map.of(
            "service_fee", ServiceFee::new,
            "eco_fee", EcoFee::new);

    private Plugins() {
    }

    public static FeePlugin load(String name) {
        Supplier<FeePlugin> s = REGISTRY.get(name);
        if (s == null) {
            throw new NoSuchElementException("no fee plugin " + name);
        }
        return s.get();
    }

    public static Money totalFees(Money base) {
        Money total = Money.zero();
        for (String name : AppConfig.getList("fee_plugins")) {
            total = total.plus(load(name).fee(base));
        }
        return total;
    }
}
