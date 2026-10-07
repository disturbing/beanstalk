package shop.plugins;

import shop.core.Money;

public final class ServiceFee implements FeePlugin {
    public static final double RATE = 0.02;

    @Override
    public Money fee(Money base) {
        return base.pct(RATE);
    }
}
