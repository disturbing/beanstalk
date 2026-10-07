package shop.fulfil;

import java.util.Map;
import shop.catalog.Inventory;
import shop.core.Bus;
import shop.core.Sequence;
import shop.sales.Cart;
import shop.sales.Line;
import shop.sales.Pricing;

public final class OrderService {
    private final Inventory inventory;
    private final Bus bus;
    private final Sequence seq = new Sequence("ORD");

    public OrderService(Inventory inventory) {
        this(inventory, null);
    }

    public OrderService(Inventory inventory, Bus bus) {
        this.inventory = inventory;
        this.bus = bus == null ? new Bus() : bus;
    }

    public Bus bus() {
        return bus;
    }

    public Order place(Cart cart) {
        return place(cart, null);
    }

    public Order place(Cart cart, String coupon) {
        for (Map.Entry<String, Line> e : cart.lines().entrySet()) {
            inventory.reserve(e.getKey(), e.getValue().qty());
        }
        Order order = new Order(seq.take(), cart, Pricing.quote(cart, coupon));
        bus.emit("order.placed", order.id());
        return order;
    }

    public void cancel(Order order) {
        order.move("cancelled");
        for (Map.Entry<String, Line> e : order.cart().lines().entrySet()) {
            inventory.release(e.getKey(), e.getValue().qty());
        }
        bus.emit("order.cancelled", order.id());
    }
}
