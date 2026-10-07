package shop.billing;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import shop.config.AppConfig;
import shop.core.Money;
import shop.fulfil.Order;
import shop.sales.Line;
import shop.sales.Quote;
import shop.util.Strings;

public final class Invoice {
    public static final int WIDTH = 32;

    private Invoice() {
    }

    public static String render(Order order) {
        List<String> rows = new ArrayList<>();
        rows.add("INVOICE " + order.id());
        for (Line line : new TreeMap<>(order.cart().lines()).values()) {
            rows.add(row(line.qty() + " x " + line.product().name(), line.total()));
        }
        Quote q = order.quote();
        for (Map.Entry<String, Money> e : List.of(
                Map.entry("Subtotal", q.subtotal()), Map.entry("Discount", q.discount()),
                Map.entry("Shipping", q.shipping()), Map.entry("Fees", q.fees()),
                Map.entry("Tax", q.tax()), Map.entry("Total", q.total()))) {
            rows.add(row(e.getKey(), e.getValue()));
        }
        rows.add(AppConfig.get("invoice_footer", ""));
        return String.join("\n", rows);
    }

    private static String row(String label, Money amount) {
        return Strings.padRight(label, 20) + Strings.padLeft(amount.format(), 12);
    }
}
