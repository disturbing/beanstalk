package shop.sales;

import shop.catalog.Product;
import shop.core.Money;

public final class Line {
    private final Product product;
    private int qty;

    public Line(Product product, int qty) {
        this.product = product;
        this.qty = qty;
    }

    public Product product() {
        return product;
    }

    public int qty() {
        return qty;
    }

    void addQty(int more) {
        qty += more;
    }

    public Money total() {
        return product.price().times(qty);
    }
}
