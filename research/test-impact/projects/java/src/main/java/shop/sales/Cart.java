package shop.sales;

import java.util.LinkedHashMap;
import java.util.Map;
import shop.catalog.Catalog;
import shop.core.Limits;
import shop.core.Money;

public final class Cart {
    private final Map<String, Line> lines = new LinkedHashMap<>();

    public Map<String, Line> lines() {
        return lines;
    }

    public void add(String sku) {
        add(sku, 1);
    }

    public void add(String sku, int qty) {
        if (qty <= 0 || qty > Limits.MAX_QTY) {
            throw new IllegalArgumentException("qty must be in 1.." + Limits.MAX_QTY);
        }
        Line existing = lines.get(sku);
        if (existing != null) {
            existing.addQty(qty);
        } else {
            lines.put(sku, new Line(Catalog.find(sku), qty));
        }
    }

    public void remove(String sku) {
        lines.remove(sku);
    }

    public Money subtotal() {
        Money total = Money.zero();
        for (Line line : lines.values()) {
            total = total.plus(line.total());
        }
        return total;
    }

    public int weightG() {
        int sum = 0;
        for (Line l : lines.values()) {
            sum += l.product().weightG() * l.qty();
        }
        return sum;
    }

    public int count() {
        int sum = 0;
        for (Line l : lines.values()) {
            sum += l.qty();
        }
        return sum;
    }
}
