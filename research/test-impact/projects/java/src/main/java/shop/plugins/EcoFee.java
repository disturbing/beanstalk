package shop.plugins;

import shop.core.Money;

public final class EcoFee implements FeePlugin {
    @Override
    public Money fee(Money base) {
        return new Money(25);
    }
}
