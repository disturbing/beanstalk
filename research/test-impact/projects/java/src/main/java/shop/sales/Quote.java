package shop.sales;

import shop.core.Money;

public record Quote(Money subtotal, Money discount, Money shipping, Money fees, Money tax) {
    public Money total() {
        return subtotal.minus(discount).plus(shipping).plus(fees).plus(tax);
    }
}
