package shop.catalog;

public class OutOfStockException extends RuntimeException {
    public OutOfStockException(String sku) {
        super(sku);
    }
}
