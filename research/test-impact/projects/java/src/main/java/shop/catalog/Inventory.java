package shop.catalog;

import java.util.HashMap;
import java.util.Map;

public final class Inventory {
    private final Map<String, Integer> levels;
    private final Map<String, Integer> reserved = new HashMap<>();

    public Inventory() {
        this(Map.of());
    }

    public Inventory(Map<String, Integer> levels) {
        this.levels = new HashMap<>(levels);
    }

    public Map<String, Integer> levels() {
        return levels;
    }

    public int available(String sku) {
        return levels.getOrDefault(sku, 0) - reserved.getOrDefault(sku, 0);
    }

    public void reserve(String sku, int qty) {
        if (qty <= 0) {
            throw new IllegalArgumentException("qty must be positive");
        }
        if (available(sku) < qty) {
            throw new OutOfStockException(sku);
        }
        reserved.merge(sku, qty, Integer::sum);
    }

    public void release(String sku, int qty) {
        reserved.put(sku, Math.max(0, reserved.getOrDefault(sku, 0) - qty));
    }

    public void commit(String sku, int qty) {
        release(sku, qty);
        levels.put(sku, levels.getOrDefault(sku, 0) - qty);
    }
}
