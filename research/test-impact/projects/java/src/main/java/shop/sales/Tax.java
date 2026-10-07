package shop.sales;

import java.util.HashMap;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Properties;
import shop.config.AppConfig;
import shop.config.Resources;
import shop.core.Money;

public final class Tax {
    private static Map<String, Double> table;

    private Tax() {
    }

    public static synchronized Map<String, Double> table() {
        if (table == null) {
            Properties p = Resources.properties("data/tax.properties");
            Map<String, Double> out = new HashMap<>();
            for (String k : p.stringPropertyNames()) {
                out.put(k, Double.parseDouble(p.getProperty(k).trim()));
            }
            table = Map.copyOf(out);
        }
        return table;
    }

    public static double rate() {
        return rate(null);
    }

    public static double rate(String region) {
        String r = (region == null || region.isEmpty()) ? AppConfig.get("tax_region") : region;
        Double v = table().get(r);
        if (v == null) {
            throw new NoSuchElementException(r);
        }
        return v;
    }

    public static Money taxOn(Money amount) {
        return taxOn(amount, null);
    }

    public static Money taxOn(Money amount, String region) {
        return amount.pct(rate(region));
    }
}
