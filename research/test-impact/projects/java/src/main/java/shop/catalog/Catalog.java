package shop.catalog;

import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import shop.config.Resources;
import shop.core.Money;
import shop.util.Validation;

public final class Catalog {
    private static Map<String, Product> products;

    private Catalog() {
    }

    public static synchronized Map<String, Product> catalog() {
        if (products == null) {
            Map<String, Product> out = new LinkedHashMap<>();
            List<String> lines = Resources.lines("data/catalog.csv");
            for (String line : lines.subList(1, lines.size())) {
                String[] c = line.split(",");
                Validation.require(Validation.isSku(c[0]), "bad sku " + c[0]);
                out.put(c[0], new Product(c[0], c[1], new Money(Long.parseLong(c[2])),
                        Integer.parseInt(c[3]), c[4]));
            }
            products = Collections.unmodifiableMap(out);
        }
        return products;
    }

    public static Product find(String sku) {
        Product p = catalog().get(sku);
        if (p == null) {
            throw new NoSuchElementException("no product " + sku);
        }
        return p;
    }

    public static List<Product> byCategory(String category) {
        return catalog().values().stream()
                .filter(p -> p.category().equals(category))
                .sorted(Comparator.comparing(Product::sku))
                .toList();
    }
}
