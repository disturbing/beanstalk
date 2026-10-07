package shop.testkit;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import shop.catalog.Inventory;
import shop.sales.Cart;

/** Shared test helpers: cart factories, the stocked inventory and the order fixtures. */
public final class Factories {
    public record FixtureOrder(Map<String, Integer> lines, String coupon) {
    }

    private Factories() {
    }

    /** cartOf("SKU-001", 2, "SKU-003", 1) */
    public static Cart cartOf(Object... skuQtyPairs) {
        Map<String, Integer> lines = new LinkedHashMap<>();
        for (int i = 0; i < skuQtyPairs.length; i += 2) {
            lines.put((String) skuQtyPairs[i], (Integer) skuQtyPairs[i + 1]);
        }
        return cartOf(lines);
    }

    public static Cart cartOf(Map<String, Integer> lines) {
        Cart cart = new Cart();
        lines.forEach(cart::add);
        return cart;
    }

    public static Inventory stocked() {
        Map<String, Integer> levels = new LinkedHashMap<>();
        levels.put("SKU-001", 10);
        levels.put("SKU-002", 5);
        levels.put("SKU-003", 100);
        levels.put("SKU-004", 2);
        levels.put("SKU-005", 20);
        levels.put("SKU-006", 3);
        return new Inventory(levels);
    }

    /** Reads fixtures/orders.txt: "SKU-001:2,SKU-003:4 | PCT10" per line, "-" for no coupon. */
    public static List<FixtureOrder> fixtureOrders() {
        String text;
        try (InputStream in = Factories.class.getClassLoader().getResourceAsStream("fixtures/orders.txt")) {
            if (in == null) {
                throw new IOException("missing fixtures/orders.txt");
            }
            text = new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        List<FixtureOrder> out = new ArrayList<>();
        for (String raw : text.lines().toList()) {
            String line = raw.strip();
            if (line.isEmpty() || line.startsWith("#")) {
                continue;
            }
            String[] halves = line.split("\\|");
            Map<String, Integer> lines = new LinkedHashMap<>();
            for (String item : halves[0].strip().split(",")) {
                String[] kv = item.strip().split(":");
                lines.put(kv[0], Integer.parseInt(kv[1]));
            }
            String coupon = halves[1].strip();
            out.add(new FixtureOrder(lines, coupon.equals("-") ? null : coupon));
        }
        return out;
    }
}
