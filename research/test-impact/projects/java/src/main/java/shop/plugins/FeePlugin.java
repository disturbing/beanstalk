package shop.plugins;

import shop.core.Money;

public interface FeePlugin {
    Money fee(Money base);
}
