package shop.core;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import shop.config.Resources;

public final class Currency {
    private static Map<String, Double> rates;

    private Currency() {
    }

    public static synchronized Map<String, Double> rates() {
        if (rates == null) {
            Map<String, Double> out = new LinkedHashMap<>();
            List<String> lines = Resources.lines("data/rates.csv");
            for (String line : lines.subList(1, lines.size())) {
                String[] cols = line.split(",");
                out.put(cols[0], Double.parseDouble(cols[1]));
            }
            rates = Collections.unmodifiableMap(out);
        }
        return rates;
    }

    public static Money convert(Money m, String to) {
        Map<String, Double> table = rates();
        if (!table.containsKey(m.currency()) || !table.containsKey(to)) {
            throw new NoSuchElementException("unknown currency " + m.currency() + "->" + to);
        }
        double usd = m.cents() / table.get(m.currency());
        return new Money(Money.roundHalfUp(usd * table.get(to)), to);
    }
}
