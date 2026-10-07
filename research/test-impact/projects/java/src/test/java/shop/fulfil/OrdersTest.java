package shop.fulfil;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static shop.testkit.Factories.cartOf;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import shop.catalog.Inventory;
import shop.core.Bus;
import shop.testkit.Factories;

class OrdersTest {
    private Inventory stocked;

    @BeforeEach
    void setUp() {
        stocked = Factories.stocked();
    }

    @Test
    void placeReservesAndEmits() {
        Bus bus = new Bus();
        List<String> seen = new ArrayList<>();
        bus.on("order.placed", seen::add);
        OrderService svc = new OrderService(stocked, bus);
        Order order = svc.place(cartOf("SKU-004", 2));
        assertEquals("ORD00001", order.id());
        assertEquals(0, stocked.available("SKU-004"));
        assertEquals(List.of("ORD00001"), seen);
    }

    @Test
    void cancelReleases() {
        OrderService svc = new OrderService(stocked);
        Order order = svc.place(cartOf("SKU-006", 3));
        svc.cancel(order);
        assertEquals("cancelled", order.state());
        assertEquals(3, stocked.available("SKU-006"));
    }

    @Test
    void badTransition() {
        Order order = new OrderService(stocked).place(cartOf("SKU-001", 1));
        assertThrows(IllegalArgumentException.class, () -> order.move("shipped"));
    }

    @Test
    void fixtureOrders() {
        OrderService svc = new OrderService(stocked);
        List<String> ids = Factories.fixtureOrders().stream()
                .map(o -> svc.place(cartOf(o.lines()), o.coupon()).id())
                .toList();
        assertEquals(List.of("ORD00001", "ORD00002", "ORD00003", "ORD00004"), ids);
    }
}
