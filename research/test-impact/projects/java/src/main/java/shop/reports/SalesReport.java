package shop.reports;

import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import shop.core.Limits;
import shop.core.Money;
import shop.fulfil.Order;
import shop.sales.Line;

public final class SalesReport {
    private SalesReport() {
    }

    public static Money revenue(List<Order> orders) {
        Money total = Money.zero();
        for (Order o : orders) {
            if (!o.state().equals("cancelled")) {
                total = total.plus(o.quote().total());
            }
        }
        return total;
    }

    public static List<Map.Entry<String, Integer>> topSkus(List<Order> orders) {
        return topSkus(orders, Limits.DEFAULT_PAGE);
    }

    public static List<Map.Entry<String, Integer>> topSkus(List<Order> orders, int n) {
        Map<String, Integer> counts = new HashMap<>();
        for (Order o : orders) {
            for (Map.Entry<String, Line> e : o.cart().lines().entrySet()) {
                counts.merge(e.getKey(), e.getValue().qty(), Integer::sum);
            }
        }
        return counts.entrySet().stream()
                .sorted(Comparator.<Map.Entry<String, Integer>>comparingInt(e -> -e.getValue())
                        .thenComparing(Map.Entry::getKey))
                .limit(n)
                .map(e -> Map.entry(e.getKey(), e.getValue()))
                .toList();
    }
}
