package shop.catalog;

import shop.core.Money;

public record Product(String sku, String name, Money price, int weightG, String category) {
}
