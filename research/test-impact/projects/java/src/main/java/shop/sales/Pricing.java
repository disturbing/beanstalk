package shop.sales;

import shop.core.Money;
import shop.fulfil.Shipping;
import shop.plugins.Plugins;

public final class Pricing {
    private Pricing() {
    }

    public static Quote quote(Cart cart) {
        return quote(cart, null);
    }

    public static Quote quote(Cart cart, String coupon) {
        return quote(cart, coupon, "domestic", null);
    }

    public static Quote quote(Cart cart, String coupon, String zone, String region) {
        Money subtotal = cart.subtotal();
        Money discount = Money.zero();
        Money ship = Shipping.cost(cart, zone);
        if (coupon != null && !coupon.isEmpty()) {
            Coupon c = Coupons.parse(coupon);
            switch (c.kind()) {
                case "percent" -> discount = Discounts.percentOff(cart, c.value());
                case "amount" -> discount = new Money(Math.min(c.value(), subtotal.cents()));
                case "shipping" -> ship = Money.zero();
                default -> { }
            }
        }
        Money fees = Plugins.totalFees(subtotal.minus(discount));
        Money taxed = Tax.taxOn(subtotal.minus(discount), region);
        return new Quote(subtotal, discount, ship, fees, taxed);
    }
}
